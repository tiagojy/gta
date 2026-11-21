import { CityMap } from '../world/city-map.js?v=31';
import { RoadPathfinder } from '../world/pathfinding.js?v=2';
import { TrafficManager } from '../world/traffic-manager.js?v=25';
import { BoatManager } from '../world/boat-manager.js?v=17';
import { InputManager } from '../input/input-manager.js?v=24';
import { WebGLRenderer } from '../render/webgl-renderer.js?v=34';
import { isInWater, resolveCircleStaticObstacle, resolveEntityCollisions, resolveVehiclePairCollision } from '../physics/collision.js?v=11';
import {
  applyPedestrianDamage,
  applyVehicleDamage,
  computeShockwaveDamage,
  computeShockwaveFalloff,
  createTrashBinEntity,
  createVehicleEntity,
  evaluateVehicleImpact,
  findNearestVehicle,
  findSafeExitPosition,
  hitTrashBin,
  isTouchingVehicle,
  NPC_VEHICLE_CRUISE_SPEED,
  updateEjectedPlayer,
  updatePedestrian,
  updateTrashBin,
  updateVehicle,
  updateVehicleCriticalState
} from '../physics/vehicle-physics.js?v=19';
import { Minimap } from '../ui/minimap.js?v=29';
import { Inventory } from './inventory.js?v=20';
import {
  addAmmo,
  getWeaponDef,
  isReloading,
  startReload,
  tryFireBullets,
  updateBullets,
  updateWeaponState
} from '../combat/weapons.js?v=4';
import { rollPedestrianCash } from '../combat/cash-drops.js?v=1';

const DEFAULT_MISSION_REWARD = 100;
const LOCK_PICK_RADIUS = 24;
const LOCK_MAX_RANGE = 600;
const LOCK_CYCLE_RANGE = 520;
const SHOP_COUNTER_REACH = 60;
const VEHICLE_BULLET_FACTOR = 0.5; // dano da bala em veículo = dano da arma x este fator
const PICKUP_CLEARANCE = 14; // folga mínima entre um item e paredes/objetos
const WAYPOINT_REACHED_RADIUS = 76;
const WAYPOINT_CANCEL_RADIUS = 60;
const CASH_PICKUP_RADIUS = 30;
const CASH_DROP_LIFETIME = 90;
import { createSaveSnapshot, saveGameState } from './save-state.js?v=5';
import { applyCheat } from './cheats.js?v=3';
import { CheatConsole } from '../ui/cheat-console.js?v=1';
import { ShopMenu } from '../ui/shop-menu.js?v=1';
import { absorbDamage, sanitizeArmor } from '../combat/armor.js?v=1';
import { applyPickupEffect, createPickupState, findPickupsInReach, removePickup, updatePickups } from '../combat/pickups.js?v=1';
import { scareNearbyPedestrians, scarePedestrian } from '../combat/panic.js?v=1';
import { spawnCasing, updateCasings } from '../combat/casings.js?v=1';
import { SoundManager } from '../audio/sound-manager.js?v=1';
import { pickChatLine } from '../story/chat-lines.js?v=1';
import {
  createArsenal,
  cycleWeapon,
  equipSlot,
  getEquipped,
  restoreArsenal,
  serializeArsenal
} from '../combat/arsenal.js?v=2';
import { GUN_SHOP_CODE, GUN_SHOP_NAME, describeOffers, purchaseItem } from '../shop/shop-data.js?v=2';
import { getPendingMissionAssetUrls, preloadMissionAssets } from '../story/story-loader.js';

const PEDESTRIAN_CHAT_LINES = [
  'Opa! Cuidado com o trânsito por aqui!',
  'Você viu onde deixei a chave do meu carro?',
  'Dia bonito para dar uma volta na praça, né?',
  'Dizem que o Empório São Jorge tem as melhores entregas!',
  'Ei, você parece com pressa! Tá fazendo alguma missão?',
  'Se acelerar demais nas curvas vai sair derrapando!',
  'Tô só dando uma caminhada tranquila na calçada.',
  'Hoje a cidade está bem movimentada!',
  'Cuidado para não cair na água nas bordas da ilha!',
  'Se precisar de carona, tem vários carros estacionados por aí.'
];

export class Engine {
  constructor(canvas, minimapCanvas, touchControlsEl, hud, options = {}) {
    this.canvas = canvas;
    this.hud = hud;
    this.renderer = new WebGLRenderer(canvas);
    this.minimap = new Minimap(minimapCanvas);
    this.input = new InputManager(touchControlsEl);

    this.cityMap = options.cityMap || null;
    this.storyPackage = options.storyPackage || null;
    this.locationNames = this.storyPackage?.locationNames || new Map();
    this.cutscene = options.cutscene || null;
    this.pauseMenu = options.pauseMenu || null;
    this.inventoryController = options.inventoryController || null;
    this.preloadedUrls = options.preloadedUrls || new Set();
    this.onExitToTitle = options.onExitToTitle || null;
    this.onNewGame = options.onNewGame || null;
    this.onRefreshAssets = options.onRefreshAssets || null;
    this.onResetGame = options.onResetGame || null;

    this.inventory = new Inventory();
    this.awaitingExitTarget = false;
    this.currentMissionIndex = 0;
    this.freeRoamMode = !this.storyPackage;
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];
    this.encounterNpcs = [];
    this.encounterLocationCodes = new Map();
    this.paused = false;
    this.hudDisplayHealth = 100;
    this.wasInsideHospital = false;
    this.collectibleFullToastCooldown = 0;
    this.worldCollectibles = [];
    this.collectedExtraIds = new Set();
    this.unlockedMissionIndices = new Set([0]);

    this.pathfinder = null;
    this.trafficManager = null;
    this.vehicles = [];
    this.activeChunkKeys = new Set();
    this.lastVehicleChunkKey = null;
    this.skidMarks = [];
    this.bloodMarks = [];
    this.bullets = [];
    this.smokeParticles = [];
    this.explosions = [];
    this.routePoints = [];
    this.waypoint = null;
    this.waypointRoutePoints = [];
    this.cashDrops = [];
    this.objectiveCode = null;
    this.objectivePoint = null;
    this.objectiveNpcPoint = null;
    this.completedNpcPoints = [];
    this.objectiveLocationType = null;
    this.routeTimer = 0;
    this.elapsedTime = 0;
    this.lastTimestamp = 0;
    this.running = false;

    this.player = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      walkPhase: 0,
      radius: 11,
      health: 100,
      isDead: false,
      deathReason: null,
      inVehicleId: null,
      insideLocationCode: null,
      currentLocationCode: null,
      sinkScale: 1,
      sinkAlpha: 1,
      sinkProgress: 0,
      ejected: { active: false, vx: 0, vy: 0, hitCooldown: 0, graceTimer: 0, sourceVehicleId: null },
      sinking: { active: false, timer: 0, duration: 1.35, vehicleId: null, vx: 0, vy: 0 }
    };

    this.camera = { x: 0, y: 0 };
    this.money = 0;
    this.arsenal = null;
    this.shopCounter = undefined;
    this.lockedTarget = null;
    this.armor = 0;
    this.pickups = createPickupState();
    this.casings = [];
    this.combatClock = 0;
    this.lastShotAt = -Infinity;
    this.emptyClickCooldown = 0;
    this.sound = new SoundManager();
    this.sound.attachUnlock(window);
    this.shopMenu = new ShopMenu({
      container: document.getElementById('game-shell'),
      onBuy: (itemId) => this.#buyShopItem(itemId),
      onOpen: () => { this.paused = true; },
      onClose: () => { this.paused = false; }
    });
    this.cheatConsole = new CheatConsole({
      container: document.getElementById('game-shell'),
      onSubmit: (value) => this.#runCheat(value),
      onOpen: () => { this.paused = true; },
      onClose: () => { this.paused = false; }
    });
    this.hud.onRestartClick(() => {
      if (this.storyPackage && !this.freeRoamMode) {
        this.startMission(this.currentMissionIndex, { skipIntro: true });
      } else {
        this.resetMatch();
      }
    });

    this.hud.onInventoryClick(() => {
      if (!this.running || this.player.isDead || this.deathSequence || this.cutscene?.active || this.hud.isMissionCompleteOpen() || this.paused) {
        return;
      }
      if (this.inventoryController?.isOpen) {
        if (this.inventoryController.mode === 'browse') this.inventoryController.close();
      } else {
        this.openInventory();
      }
    });
    this.#syncInventoryHud();

    this.hud.onMinimapClick(() => {
      if (!this.running || this.player.isDead || this.deathSequence || this.cutscene?.active || this.hud.isMissionCompleteOpen() || this.inventoryController?.isOpen || this.paused) {
        return;
      }
      this.openExpandedMap();
    });
    this.hud.onExpandedMapClose(() => this.closeExpandedMap());
    this.hud.onExpandedMapTransform((action) => this.#applyExpandedMapTransform(action));
    this.hud.onExpandedMapWaypoint((pt) => this.#handleMapWaypointClick(pt));
    this.expandedMapView = { zoom: 1, centerX: 0, centerY: 0 };

    this.#onKeyDown = (e) => {
      if (!this.running || this.player.isDead || this.deathSequence || this.hud.isMissionCompleteOpen()) return;
      if (e.key === 'Escape' && this.hud.isExpandedMapOpen()) {
        this.closeExpandedMap();
        return;
      }
      if (e.key === 'Escape' && this.inventoryController?.isOpen) {
        this.inventoryController.close();
        return;
      }
      if (this.cutscene?.active) return;
      if (e.code === 'F2') {
        e.preventDefault();
        this.#toggleCheatConsole();
        return;
      }
      if (e.key === 'i' || e.key === 'I' || e.key === 'Tab') {
        e.preventDefault();
        if (this.hud.isExpandedMapOpen()) this.closeExpandedMap();
        if (this.inventoryController?.isOpen) {
          if (this.inventoryController.mode === 'browse') this.inventoryController.close();
        } else if (!this.paused) {
          this.openInventory();
        }
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (this.hud.isExpandedMapOpen()) {
          this.closeExpandedMap();
        } else if (!this.paused && !this.inventoryController?.isOpen) {
          this.openExpandedMap();
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.inventoryController?.isOpen || this.hud.isExpandedMapOpen() || this.pauseMenu?.confirmDialog?.isOpen || this.pauseMenu?.assetsRefreshDialog?.isOpen) return;
        if (this.pauseMenu?.isOpen) this.pauseMenu.close();
        else this.pauseMenu?.open();
      }
    };
    window.addEventListener('keydown', this.#onKeyDown);
  }

  #onKeyDown = null;

  initWorld() {
    this.hud.showLoading(35, 'Gerando ilha e cidade-base 30x30...');
    if (!this.cityMap) {
      this.cityMap = new CityMap();
    }
    this.#buildEncounterNpcs();
    this.pathfinder = new RoadPathfinder(this.cityMap);

    this.hud.showLoading(70, 'Iniciando tráfego e pedestres...');
    this.resetMatch();

    this.#handleResize();
    this.#onResize = () => this.#handleResize();
    window.addEventListener('resize', this.#onResize);

    this.#onPageHide = () => this.#persistSaveState();
    this.#onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.#persistSaveState();
      }
    };
    window.addEventListener('pagehide', this.#onPageHide);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);

    this.hud.showLoading(100, 'Pronto!');
    console.info('[Engine] Cidade-ilha inicializada com', this.cityMap.locationsByCode.size, 'locais codificados.');
  }

  #onResize = null;
  #onPageHide = null;
  #onVisibilityChange = null;

  stop() {
    this.#persistSaveState();
    this.cheatConsole?.destroy();
    this.shopMenu?.destroy();
    this.sound?.destroy();
    this.hud.clearNpcSpeechBubbles?.();
    this.running = false;
    if (this.#onKeyDown) window.removeEventListener('keydown', this.#onKeyDown);
    if (this.#onResize) window.removeEventListener('resize', this.#onResize);
    if (this.#onPageHide) window.removeEventListener('pagehide', this.#onPageHide);
    if (this.#onVisibilityChange) document.removeEventListener('visibilitychange', this.#onVisibilityChange);
  }

  #persistSaveState() {
    if (!this.storyPackage || this.player?.isDead || this.deathSequence) return;
    const snapshot = createSaveSnapshot({
      storyKey: this.storyPackage.title || 'default',
      currentMissionIndex: this.currentMissionIndex,
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      freeRoamMode: this.freeRoamMode,
      itemPickedUp: this.itemPickedUp,
      inventorySlots: this.inventory.getSlots(),
      collectedExtraIds: [...this.collectedExtraIds],
      completedNpcPoints: this.completedNpcPoints,
      money: this.money,
      armor: this.armor,
      weapon: this.player.weapon
        ? { id: this.player.weapon.id, ammoInMag: this.player.weapon.ammoInMag, ammoReserve: this.player.weapon.ammoReserve }
        : null,
      arsenal: serializeArsenal(this.arsenal),
      player: {
        x: this.player.x,
        y: this.player.y,
        angle: this.player.angle,
        health: this.player.health,
      },
    });
    saveGameState(snapshot);
  }

  applyRefreshedStoryPackage(freshPackage) {
    if (!freshPackage) return;
    this.storyPackage = freshPackage;
    this.locationNames = freshPackage.locationNames || new Map();
    this.#buildEncounterNpcs();
    if (this.freeRoamMode || !freshPackage.missions?.length) return;
    const clamped = Math.max(0, Math.min(this.currentMissionIndex, freshPackage.missions.length - 1));
    this.currentMissionIndex = clamped;
    this.pauseMenu?.configure(freshPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      },
    });
    this.#syncInventoryHud();
  }

  async restoreSavedSession(savedState) {
    if (!savedState || !this.storyPackage || !this.storyPackage.missions?.length) {
      return this.startMission(0);
    }

    const clamped = Math.max(
      0,
      Math.min(savedState.currentMissionIndex || 0, this.storyPackage.missions.length - 1),
    );
    this.unlockedMissionIndices = new Set([0, ...(savedState.unlockedMissionIndices || [])]);
    if (!savedState.freeRoamMode) {
      this.unlockedMissionIndices.add(clamped);
    }
    const mission = this.storyPackage.missions[clamped];
    const pendingUrls = getPendingMissionAssetUrls(this.storyPackage, clamped, this.preloadedUrls, {
      includeSplash: false,
    });

    if (pendingUrls.length > 0) {
      this.paused = true;
      this.hud.showLoading(10, `Carregando ${mission.title}...`);
      await preloadMissionAssets(this.storyPackage, clamped, {
        includeSplash: false,
        preloadedUrls: this.preloadedUrls,
        onProgress: ({ loaded, total, ratio }) => {
          this.hud.showLoading(10 + ratio * 85, `Carregando recursos da missão (${loaded}/${total})...`);
        },
      });
      this.hud.showLoading(100, 'Missão pronta!');
      this.hud.showGameHud();
      this.paused = false;
    }

    this.currentMissionIndex = clamped;
    this.freeRoamMode = Boolean(savedState.freeRoamMode);
    this.missionOutTriggered = false;
    this.awaitingExitTarget = false;
    const needsPickup = Boolean(mission.pickupLocation && mission.giveItem);
    this.itemPickedUp = needsPickup ? Boolean(savedState.itemPickedUp) : true;
    const initialObjective = this.freeRoamMode
      ? null
      : (this.itemPickedUp || !needsPickup ? mission.targetLocation : mission.pickupLocation);

    this.resetMatch(mission.startLocation, initialObjective);

    this.money = Math.max(0, Math.floor(Number(savedState.money) || 0));
    this.armor = sanitizeArmor(savedState.armor);
    this.arsenal = restoreArsenal(savedState.arsenal, savedState.weapon);
    this.player.weapon = getEquipped(this.arsenal);

    this.inventory.clear();
    for (const slot of savedState.inventorySlots || []) {
      if (slot && !this.inventory.hasItem(slot.id)) {
        this.inventory.addItem(slot);
      }
    }
    this.#syncInventoryHud();

    this.collectedExtraIds = new Set(savedState.collectedExtraIds || []);
    for (const c of this.worldCollectibles) {
      if (this.collectedExtraIds.has(c.id) || this.inventory.hasItem(c.id)) {
        c.collected = true;
        this.collectedExtraIds.add(c.id);
      }
    }
    this.worldCollectibles = this.worldCollectibles.filter((c) => !c.collected);

    this.completedNpcPoints = Array.isArray(savedState.completedNpcPoints)
      ? savedState.completedNpcPoints.map((pt) => ({ x: pt.x, y: pt.y }))
      : [];

    if (savedState.player) {
      this.player.x = savedState.player.x;
      this.player.y = savedState.player.y;
      this.player.angle = savedState.player.angle || 0;
      this.player.health = savedState.player.health || 100;
      this.hudDisplayHealth = this.player.health;
      this.player.inVehicleId = null;
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
      this.#syncActiveChunks(this.player.x, this.player.y);
    }

    this.pauseMenu?.configure(this.storyPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      },
    });

    if (!this.freeRoamMode) {
      const bannerObjective = !this.itemPickedUp && needsPickup
        ? (mission.pickupObjective || mission.objective)
        : mission.objective;
      this.hud?.showMissionBanner?.(clamped + 1, bannerObjective);
    } else {
      this.hud?.showToast?.('Modo exploração livre restaurado.');
    }
    this.#persistSaveState();
  }

  async startMission(index, { skipIntro = false, preserveState = false } = {}) {
    if (!this.storyPackage || !this.storyPackage.missions?.length) {
      this.freeRoamMode = true;
      this.resetMatch();
      return;
    }

    const clamped = Math.max(0, Math.min(index, this.storyPackage.missions.length - 1));
    this.unlockedMissionIndices.add(0);
    this.unlockedMissionIndices.add(clamped);
    const mission = this.storyPackage.missions[clamped];
    const pendingUrls = getPendingMissionAssetUrls(this.storyPackage, clamped, this.preloadedUrls, {
      includeSplash: false
    });

    if (pendingUrls.length > 0) {
      this.paused = true;
      this.hud.showLoading(10, `Carregando ${mission.title}...`);
      await preloadMissionAssets(this.storyPackage, clamped, {
        includeSplash: false,
        preloadedUrls: this.preloadedUrls,
        onProgress: ({ loaded, total, ratio }) => {
          this.hud.showLoading(10 + ratio * 85, `Carregando recursos da missão (${loaded}/${total})...`);
        }
      });
      this.hud.showLoading(100, 'Missão pronta!');
      this.hud.showGameHud();
      this.paused = false;
    }

    this.currentMissionIndex = clamped;
    this.freeRoamMode = false;
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];
    this.awaitingExitTarget = false;
    const needsPickup = Boolean(mission.pickupLocation && mission.giveItem);
    this.itemPickedUp = !needsPickup;
    const initialObjective = needsPickup ? mission.pickupLocation : mission.targetLocation;

    if (preserveState) {
      const currentVehicle = this.player.inVehicleId
        ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
        : null;
      this.player.speed = 0;
      if (currentVehicle) {
        currentVehicle.vx = 0;
        currentVehicle.vy = 0;
        currentVehicle.speed = 0;
      }
      this.setObjective(initialObjective);
      this.#syncActiveChunks(this.player.x, this.player.y);
      this.trafficManager?.normalizeTrafficAtMissionStart?.(this.vehicles, this.player);
      this.hud.hideGameOver();
      this.missionCheckpoint = {
        missionIndex: clamped,
        x: this.player.x,
        y: this.player.y,
        angle: this.player.angle,
        health: this.player.health,
        inVehicleId: this.player.inVehicleId,
        vehiclePos: currentVehicle ? { x: currentVehicle.x, y: currentVehicle.y, angle: currentVehicle.angle } : null,
        inventorySlots: this.inventory.getSlots()
      };
    } else if (this.missionCheckpoint && this.missionCheckpoint.missionIndex === clamped) {
      const cp = this.missionCheckpoint;
      this.resetMatch(mission.startLocation, initialObjective);
      this.inventory.restorePreservingExtras(cp.inventorySlots);
      this.#syncInventoryHud();
      if (needsPickup && mission.giveItem && this.inventory.hasItem(mission.giveItem)) {
        this.itemPickedUp = true;
        this.setObjective(mission.targetLocation);
      }
      this.player.x = cp.x;
      this.player.y = cp.y;
      this.player.angle = cp.angle;
      this.player.health = cp.health;
      this.player.inVehicleId = cp.inVehicleId;
      if (cp.inVehicleId && cp.vehiclePos) {
        const v = this.vehicles.find((veh) => veh.id === cp.inVehicleId);
        if (v) {
          v.x = cp.vehiclePos.x;
          v.y = cp.vehiclePos.y;
          v.angle = cp.vehiclePos.angle;
          v.driver = 'player';
          v.isParked = false;
        }
      }
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
    } else {
      this.missionCheckpoint = null;
      this.inventory.restorePreservingExtras();
      this.#syncInventoryHud();
      this.resetMatch(mission.startLocation, initialObjective);
    }

    this.pauseMenu?.configure(this.storyPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      }
    });

    const onMapReady = () => {
      if (!needsPickup && mission.giveItem && !this.inventory.hasItem(mission.giveItem)) {
        this.#grantMissionItem(mission.giveItem);
      }
      const bannerObjective = needsPickup
        ? (mission.pickupObjective || mission.objective)
        : mission.objective;
      this.hud?.showMissionBanner?.(clamped + 1, bannerObjective);
      this.#persistSaveState();
    };

    if (!skipIntro && mission.introCutscene?.steps?.length > 0 && this.cutscene) {
      this.cutscene.play(mission.introCutscene, this.storyPackage.characters, () => {
        onMapReady();
      });
    } else {
      onMapReady();
    }
  }

  #syncInventoryHud() {
    this.hud?.setInventoryCount?.(this.inventory.getCount(), this.inventory.capacity);
  }

  #grantMissionItem(itemId) {
    const itemDef = this.storyPackage?.items?.get(itemId);
    if (!itemDef) return;
    const res = this.inventory.addItem(itemDef);
    if (!res.ok && res.reason === 'inventory_full') {
      console.warn(`[Engine] Inventário cheio (${this.inventory.capacity}/${this.inventory.capacity}); não foi possível adicionar "${itemDef.name}".`);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Inventário cheio (${this.inventory.capacity}/${this.inventory.capacity})! Não foi possível guardar "${itemDef.name}".`);
      }
      return;
    }
    this.#syncInventoryHud();
    this.#persistSaveState();
  }

  openInventory() {
    if (!this.inventoryController || this.inventoryController.isOpen) return;
    this.inventoryController.openBrowse(this.inventory, () => {
      this.#syncInventoryHud();
    });
  }

  resetMatch(startCode = 'CASA-01', targetCode = null) {
    this.vehicles = [];
    this.trashBins = [];
    this.activeChunkKeys = new Set();
    this.lastVehicleChunkKey = null;
    this.trafficManager = new TrafficManager(this.cityMap, { chunkManaged: true });
    this.boatManager = new BoatManager(this.cityMap);
    this.skidMarks = [];
    this.bloodMarks = [];
    this.bullets = [];
    this.smokeParticles = [];
    this.explosions = [];
    this.cashDrops = [];
    this.pickups = createPickupState();
    this.casings = [];
    this.waypoint = null;
    this.waypointRoutePoints = [];
    this.pendingGameOver = null;
    this.deathSequence = null;
    this.hud?.setDeathDesaturation?.(0);
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];

    const startLoc = this.cityMap.resolveLocationCode(startCode);
    this.player.x = startLoc.spawnPoint.x;
    this.player.y = startLoc.spawnPoint.y;
    this.player.angle = 0;
    this.player.speed = 0;
    this.player.walkPhase = 0;
    this.player.health = 100;
    if (!this.arsenal) this.arsenal = createArsenal();
    this.player.weapon = getEquipped(this.arsenal);
    this.lockedTarget = null;
    this.hudDisplayHealth = 100;
    this.wasInsideHospital = false;
    this.collectibleFullToastCooldown = 0;
    this.worldCollectibles = [];
    this.collectedExtraIds = new Set();
    if (this.storyPackage?.items instanceof Map) {
      for (const item of this.storyPackage.items.values()) {
        if (item.category === 'extra' && item.worldPoint) {
          const alreadyCollected = this.collectedExtraIds.has(item.id) || this.inventory.hasItem(item.id);
          if (alreadyCollected) {
            this.collectedExtraIds.add(item.id);
            continue;
          }
          this.worldCollectibles.push({
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.imageUrl,
            x: item.worldPoint.x,
            y: item.worldPoint.y,
            kind: item.worldPoint.kind,
            locationCode: item.worldPoint.code,
            rarity: item.rarity || 'normal',
            collected: false
          });
        }
      }
    }
    this.player.burnCooldown = 0;
    this.player.isDead = false;
    this.player.deathReason = null;
    this.player.inVehicleId = null;
    this.player.insideLocationCode = null;
    this.player.sinkScale = 1;
    this.player.sinkAlpha = 1;
    this.player.sinkProgress = 0;
    this.player.ejected = { active: false, vx: 0, vy: 0, hitCooldown: 0, graceTimer: 0, sourceVehicleId: null };
    this.player.sinking = { active: false, timer: 0, duration: 1.35, vehicleId: null, vx: 0, vy: 0 };

    this.camera.x = this.player.x;
    this.camera.y = this.player.y;

    this.setObjective(targetCode);
    this.#syncActiveChunks(this.player.x, this.player.y);
    this.trafficManager?.normalizeTrafficAtMissionStart?.(this.vehicles, this.player);
    this.hud.hideGameOver();
  }

  #syncActiveChunks(anchorX, anchorY) {
    if (typeof this.cityMap?.getActiveChunks !== 'function') return;
    const current = this.cityMap.getChunkCoordsAt(anchorX, anchorY);
    if (this.lastVehicleChunkKey === current.key && this.activeChunkKeys.size > 0) {
      return;
    }

    const activeChunks = this.cityMap.getActiveChunks(anchorX - 10, anchorY - 10, anchorX + 10, anchorY + 10, 1);
    const nextKeys = new Set(activeChunks.map((c) => c.key));

    // Remove veículos de chunks que saíram da vizinhança ativa (preservando o carro do jogador, próximos ou em chamas)
    if (this.vehicles.length > 0) {
      this.vehicles = this.vehicles.filter((v) => {
        if (v.id === this.player.inVehicleId) return true;
        if (v.destroyed || v.burning || v.isCritical || v.claimedByPedId) return true;
        if (nextKeys.has(v.chunkKey)) return true;
        const posChunk = this.cityMap.getChunkCoordsAt(v.x, v.y);
        if (nextKeys.has(posChunk.key)) return true;
        return Math.hypot(v.x - this.player.x, v.y - this.player.y) < 1100;
      });
    }

    // Remove lixeiras de chunks que saíram da vizinhança ativa
    if (this.trashBins.length > 0) {
      this.trashBins = this.trashBins.filter((bin) => {
        if (nextKeys.has(bin.chunkKey)) return true;
        const posChunk = this.cityMap.getChunkCoordsAt(bin.x, bin.y);
        return nextKeys.has(posChunk.key) || Math.hypot(bin.x - this.player.x, bin.y - this.player.y) < 1100;
      });
    }

    const existingVehIds = new Set(this.vehicles.map((v) => v.id));
    const existingBinIds = new Set(this.trashBins.map((b) => b.id));
    for (const chunk of activeChunks) {
      if (this.activeChunkKeys.has(chunk.key)) continue;
      for (const spawn of chunk.vehicleSpawns) {
        if (existingVehIds.has(spawn.id)) continue;
        if (Math.hypot(spawn.x - this.player.x, spawn.y - this.player.y) < 90) continue;
        const veh = createVehicleEntity(spawn);
        veh.chunkKey = spawn.chunkKey;
        veh.vx = Math.cos(veh.angle) * NPC_VEHICLE_CRUISE_SPEED;
        veh.vy = Math.sin(veh.angle) * NPC_VEHICLE_CRUISE_SPEED;
        veh.speed = NPC_VEHICLE_CRUISE_SPEED;
        this.vehicles.push(veh);
        existingVehIds.add(veh.id);
      }
      for (const binSpawn of chunk.trashBinSpawns || []) {
        if (existingBinIds.has(binSpawn.id)) continue;
        const bin = createTrashBinEntity(binSpawn);
        bin.chunkKey = binSpawn.chunkKey;
        this.trashBins.push(bin);
        existingBinIds.add(bin.id);
      }
    }

    this.trafficManager?.syncPedestrianChunks?.(activeChunks, nextKeys, this.player, this.activeChunkKeys);

    this.activeChunkKeys = nextKeys;
    this.lastVehicleChunkKey = current.key;
  }

  applyDamage(amount, fatalReason = 'Você se deu mal!', { bypassResistance = false } = {}) {
    if (this.player.isDead || amount <= 0) return;
    const effectiveDamage = bypassResistance ? amount : Math.max(1, Math.round(amount * 0.55));
    const absorbed = absorbDamage(this.armor, effectiveDamage);
    this.armor = absorbed.armor;
    this.player.health = Math.max(0, this.player.health - absorbed.healthDamage);
    this.hud.triggerDamageFlash();
    if (this.player.health <= 0) {
      this.triggerGameOver(fatalReason);
    }
  }

  triggerGameOver(reason) {
    if (this.player.isDead || this.deathSequence) return;
    this.pendingGameOver = null;
    this.player.health = 0;
    this.player.deathReason = reason;
    this.deathSequence = {
      timer: 0,
      duration: 3.0,
      reason
    };
  }

  #finalizeGameOver(reason) {
    this.deathSequence = null;
    this.armor = 0;
    this.player.isDead = true;
    this.player.health = 0;
    this.player.deathReason = reason;
    this.hud?.setDeathDesaturation?.(1);
    this.hud.showGameOver(reason);
  }

  getLocationDisplayName(code) {
    if (!code) return '';
    return this.locationNames.get(code) || code;
  }

  setObjective(code) {
    if (!code) {
      this.objectiveCode = null;
      this.objectivePoint = null;
      this.objectiveNpcPoint = null;
      this.objectiveLocationType = null;
      this.routePoints = [];
      return;
    }
    const target = this.cityMap.resolveLocationCode(code);
    this.objectiveCode = target.code;
    this.objectivePoint = { ...target.spawnPoint, doorSide: target.doorSide || null };
    this.objectiveLocationType = target.type || null;
    if ((target.type === 'commerce' || target.type === 'house') && target.bounds) {
      this.objectiveNpcPoint = {
        x: target.bounds.x + target.bounds.w * 0.5,
        y: target.bounds.y + target.bounds.h * 0.55
      };
    } else {
      this.objectiveNpcPoint = target.spawnPoint;
    }
    this.routePoints = this.pathfinder.findRoute(this.player.x, this.player.y, this.objectiveCode);
  }

  #worldToScreen(worldX, worldY) {
    const zoom = this.renderer?.zoom || 1;
    const viewW = this.renderer?.viewWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const viewH = this.renderer?.viewHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
    return {
      x: (worldX - this.camera.x) * zoom + viewW * 0.5,
      y: (worldY - this.camera.y) * zoom + viewH * 0.5
    };
  }

  #buildEncounterNpcs() {
    this.encounterNpcs = [];
    this.encounterLocationCodes = new Map();
    const encounters = this.storyPackage?.encounters;
    if (!this.cityMap || !Array.isArray(encounters) || encounters.length === 0) return;
    for (const encounter of encounters) {
      try {
        const pos = this.cityMap.resolveIndoorOppositePosition(encounter.location);
        this.encounterLocationCodes.set(encounter.location, {
          roofColor: encounter.roofColor || '#d6282e',
          roofLogo: encounter.roofLogo || '',
        });
        this.encounterNpcs.push({
          id: encounter.id,
          npc: encounter.npc,
          location: encounter.location,
          prompt: encounter.prompt,
          cutscene: encounter.cutscene,
          x: pos.x,
          y: pos.y,
          angle: pos.angle,
        });
      } catch (err) {
        console.warn(`[Engine] Não foi possível posicionar encontro "${encounter.id}": ${err.message}`);
      }
    }
  }

  #findNearbyEncounterNpc() {
    if (this.player.inVehicleId || !this.player.insideLocationCode) return null;
    for (const npc of this.encounterNpcs) {
      if (npc.location !== this.player.insideLocationCode) continue;
      if (Math.hypot(this.player.x - npc.x, this.player.y - npc.y) < 58) {
        return npc;
      }
    }
    return null;
  }

  #isPickupStageActive() {
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    return Boolean(
      !this.itemPickedUp &&
      activeMission?.pickupLocation &&
      activeMission?.giveItem &&
      this.objectivePoint
    );
  }

  #isNearInteriorStoryNpc() {
    if (this.player.inVehicleId || this.#isPickupStageActive() || !this.objectiveNpcPoint) return false;
    const requiresBuildingEntry =
      this.objectiveLocationType === 'commerce' || this.objectiveLocationType === 'house';
    if (!requiresBuildingEntry) return false;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    if (!activeMission || this.player.insideLocationCode !== activeMission.targetLocation) return false;
    return Math.hypot(this.player.x - this.objectiveNpcPoint.x, this.player.y - this.objectiveNpcPoint.y) < 58;
  }

  #resolvePlayerMissionNpcCollision() {
    if (this.player.inVehicleId || this.player.isDead) {
      return;
    }
    const npcs = [...(this.completedNpcPoints || []), ...(this.encounterNpcs || [])];
    if (!this.#isPickupStageActive() && !this.missionOutTriggered && !this.freeRoamMode && this.objectiveNpcPoint) {
      npcs.push(this.objectiveNpcPoint);
    }
    if (npcs.length === 0) return;

    const radius = this.player.radius || 11;
    for (const npc of npcs) {
      const hit = resolveCircleStaticObstacle(this.player.x, this.player.y, radius, npc.x, npc.y, 11);
      if (!hit.collided) continue;
      const env = resolveEntityCollisions(hit.x, hit.y, radius, this.cityMap.getCollidersAround(hit.x, hit.y, 80));
      this.player.x = env.x;
      this.player.y = env.y;
    }
  }

  #findNearestTalkablePedestrian(x, y, maxDist = 52) {
    const peds = this.trafficManager?.pedestrians;
    if (!Array.isArray(peds)) return null;
    let best = null;
    let bestDist = maxDist;
    for (const ped of peds) {
      if (!ped || ped.isDead || ped.knockedDown || ped.state === 'downed') continue;
      const d = Math.hypot(x - ped.x, y - ped.y);
      if (d < bestDist) {
        bestDist = d;
        best = ped;
      }
    }
    return best;
  }

  #handleMissionArrival() {
    const mission = this.storyPackage.missions[this.currentMissionIndex];
    if (!mission) return;

    this.player.speed = 0;
    const finishMission = () => {
      if (this.objectiveNpcPoint) {
        const alreadySaved = this.completedNpcPoints.some(
          (pt) => Math.hypot(pt.x - this.objectiveNpcPoint.x, pt.y - this.objectiveNpcPoint.y) < 4
        );
        if (!alreadySaved) {
          this.completedNpcPoints.push({ x: this.objectiveNpcPoint.x, y: this.objectiveNpcPoint.y });
        }
      }
      this.setObjective(null);
      const hasNext = this.currentMissionIndex + 1 < this.storyPackage.missions.length;
      const reward = Number.isFinite(mission.reward) ? mission.reward : DEFAULT_MISSION_REWARD;
      this.addMoney(reward);
      this.paused = true;
      this.hud.showMissionComplete(mission.title, hasNext, () => {
        this.paused = false;
        if (hasNext) {
          this.startMission(this.currentMissionIndex + 1, { preserveState: true });
        } else {
          this.freeRoamMode = true;
          this.setObjective(null);
          this.#persistSaveState();
        }
      }, reward);
    };

    const openDeliveryModal = (expectedId, onSuccess, onCancel) => {
      this.inventoryController.openDelivery(this.inventory, {
        prompt: mission.deliveryPrompt || 'Escolha o item correto do seu inventário para entregar:',
        expectedItemId: expectedId || mission.requireItem,
        wrongItemMessage: mission.wrongItemMessage || 'Não é esse item que eu procuro!',
        wrongItemMessages: this.storyPackage?.wrongItemLines || [],
        onDeliver: () => {
          this.#syncInventoryHud();
          this.#persistSaveState();
          onSuccess?.();
        },
        onCancel
      });
    };

    const hasInlineDelivery = Boolean(
      mission.outroCutscene?.steps?.some((step) => step.type === 'deliver')
    );

    const runOutro = () => {
      if (mission.outroCutscene?.steps?.length > 0 && this.cutscene) {
        this.cutscene.play(
          mission.outroCutscene,
          this.storyPackage.characters,
          (result) => {
            if (result?.outcome === 'gameover') {
              this.triggerGameOver(result.reason || 'Você falhou na missão.');
            } else {
              finishMission();
            }
          },
          {
            onDeliverRequest: (stepItemId, onDelivered, onCancelled) => {
              if (!this.inventoryController) {
                onDelivered?.();
                return;
              }
              openDeliveryModal(stepItemId, onDelivered, onCancelled);
            }
          }
        );
      } else {
        finishMission();
      }
    };

    if (mission.requireItem && !hasInlineDelivery && this.inventoryController) {
      openDeliveryModal(mission.requireItem, runOutro, () => {
        this.missionOutTriggered = false;
        this.awaitingExitTarget = true;
      });
    } else {
      runOutro();
    }
  }

  #resetExpandedMapView() {
    if (!this.cityMap) return;
    this.expandedMapView = this.minimap.computeInitialExpandedView(
      this.hud.expandedMapCanvas,
      this.cityMap,
      this.player,
      this.objectivePoint,
      window.innerWidth,
      window.innerHeight,
    );
    this.hud.setExpandedMapZoomLabel(this.expandedMapView.zoom);
    this.#renderExpandedMap();
  }

  #clampExpandedMapView() {
    if (!this.cityMap) return;
    const zoom = Math.max(1, Math.min(6, this.expandedMapView.zoom || 1));
    this.expandedMapView.zoom = zoom;
    const canvas = this.hud.expandedMapCanvas;
    const baseScale = this.minimap.getExpandedBaseScale(canvas, this.cityMap);
    const scale = baseScale * zoom;
    const halfVisibleW = canvas && scale > 0 ? (canvas.width * 0.5) / scale : this.cityMap.worldWidth * 0.5;
    const halfVisibleH = canvas && scale > 0 ? (canvas.height * 0.5) / scale : this.cityMap.worldHeight * 0.5;

    if (zoom <= 1.001) {
      this.expandedMapView.zoom = 1;
      this.expandedMapView.centerX = this.cityMap.worldWidth * 0.5;
      this.expandedMapView.centerY = this.cityMap.worldHeight * 0.5;
    } else {
      if (halfVisibleW * 2 >= this.cityMap.worldWidth) {
        this.expandedMapView.centerX = this.cityMap.worldWidth * 0.5;
      } else {
        this.expandedMapView.centerX = Math.max(
          halfVisibleW,
          Math.min(this.cityMap.worldWidth - halfVisibleW, this.expandedMapView.centerX),
        );
      }
      if (halfVisibleH * 2 >= this.cityMap.worldHeight) {
        this.expandedMapView.centerY = this.cityMap.worldHeight * 0.5;
      } else {
        this.expandedMapView.centerY = Math.max(
          halfVisibleH,
          Math.min(this.cityMap.worldHeight - halfVisibleH, this.expandedMapView.centerY),
        );
      }
    }
    this.hud.setExpandedMapZoomLabel(this.expandedMapView.zoom);
  }

  #applyExpandedMapTransform(action) {
    if (!this.hud.isExpandedMapOpen() || !this.cityMap || !action) return;
    const canvas = this.hud.expandedMapCanvas;
    const baseScale = this.minimap.getExpandedBaseScale(canvas, this.cityMap);
    const curZoom = Math.max(1, Math.min(6, this.expandedMapView.zoom || 1));

    if (action.type === 'reset') {
      this.#resetExpandedMapView();
      return;
    }

    if (action.type === 'pan') {
      const scale = baseScale * curZoom;
      if (scale > 0) {
        this.expandedMapView.centerX -= (action.dx || 0) / scale;
        this.expandedMapView.centerY -= (action.dy || 0) / scale;
        this.#clampExpandedMapView();
        this.#renderExpandedMap();
      }
      return;
    }

    if (action.type === 'zoom') {
      const nextZoom = Math.max(1, Math.min(6, curZoom * (action.factor || 1)));
      if (Math.abs(nextZoom - curZoom) < 0.001 && nextZoom === curZoom) return;
      const oldScale = baseScale * curZoom;
      const newScale = baseScale * nextZoom;
      if (canvas && Number.isFinite(action.canvasX) && Number.isFinite(action.canvasY)) {
        const dx = action.canvasX - canvas.width * 0.5;
        const dy = action.canvasY - canvas.height * 0.5;
        const worldX = this.expandedMapView.centerX + dx / oldScale;
        const worldY = this.expandedMapView.centerY + dy / oldScale;
        this.expandedMapView.centerX = worldX - dx / newScale;
        this.expandedMapView.centerY = worldY - dy / newScale;
      } else if (canvas && this.player && nextZoom > curZoom) {
        const px = canvas.width * 0.5 + (this.player.x - this.expandedMapView.centerX) * oldScale;
        const py = canvas.height * 0.5 + (this.player.y - this.expandedMapView.centerY) * oldScale;
        if (px >= 0 && px <= canvas.width && py >= 0 && py <= canvas.height) {
          const dx = px - canvas.width * 0.5;
          const dy = py - canvas.height * 0.5;
          this.expandedMapView.centerX = this.player.x - dx / newScale;
          this.expandedMapView.centerY = this.player.y - dy / newScale;
        }
      }
      this.expandedMapView.zoom = nextZoom;
      this.#clampExpandedMapView();
      this.#renderExpandedMap();
    }
  }

  // Botão direito no mapa ampliado: marca (ou cancela) um destino e traça o caminho até lá.
  #handleMapWaypointClick({ canvasX, canvasY } = {}) {
    const canvas = this.hud.expandedMapCanvas;
    if (!canvas || !this.cityMap || !this.hud.isExpandedMapOpen()) return;
    if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return;
    const zoom = Math.max(1, Math.min(6, this.expandedMapView.zoom || 1));
    const scale = this.minimap.getExpandedBaseScale(canvas, this.cityMap) * zoom;
    if (!(scale > 0)) return;
    const x = this.expandedMapView.centerX + (canvasX - canvas.width * 0.5) / scale;
    const y = this.expandedMapView.centerY + (canvasY - canvas.height * 0.5) / scale;
    if (x < 0 || y < 0 || x > this.cityMap.worldWidth || y > this.cityMap.worldHeight) return;

    // Clicar de novo em cima do destino atual cancela a marcação.
    if (this.waypoint && Math.hypot(this.waypoint.x - x, this.waypoint.y - y) < 14 / scale) {
      this.clearWaypoint();
      this.#renderExpandedMap();
      return;
    }
    this.setWaypoint(x, y);
    this.#renderExpandedMap();
  }

  setWaypoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.waypoint = { x, y };
    this.waypointTimer = 0;
    this.waypointRoutePoints = this.pathfinder
      ? this.pathfinder.findRouteToPoint(this.player.x, this.player.y, x, y)
      : [];
  }

  clearWaypoint() {
    this.waypoint = null;
    this.waypointRoutePoints = [];
  }

  #updateWaypoint(dt) {
    if (!this.waypoint) return;
    const dist = Math.hypot(this.player.x - this.waypoint.x, this.player.y - this.waypoint.y);
    if (dist < WAYPOINT_REACHED_RADIUS) {
      this.clearWaypoint();
      this.hud.showToast('Você chegou ao destino marcado.');
      return;
    }
    this.waypointTimer = (this.waypointTimer || 0) + dt;
    if (this.waypointTimer >= 0.25) {
      this.waypointTimer = 0;
      this.waypointRoutePoints = this.pathfinder.findRouteToPoint(
        this.player.x, this.player.y, this.waypoint.x, this.waypoint.y
      );
    }
  }

  // Ponto de calçada livre (fora de prédios, paredes, objetos e água) para um item nascer.
  #isFreePickupPoint(x, y) {
    if (this.cityMap.getSurfaceAt(x, y) !== 'sidewalk') return false;
    const loc = this.cityMap.getLocationAt(x, y);
    if (loc && (loc.type === 'house' || loc.type === 'commerce' || loc.type === 'hospital')) return false; // dentro de prédio
    if (isInWater(x, y, this.cityMap)) return false;
    for (const r of this.cityMap.getCollidersAround(x, y, 40)) {
      if (x >= r.x - PICKUP_CLEARANCE && x <= r.x + r.w + PICKUP_CLEARANCE
        && y >= r.y - PICKUP_CLEARANCE && y <= r.y + r.h + PICKUP_CLEARANCE) {
        return false;
      }
    }
    return true;
  }

  // Caixa de munição, kit médico e colete: nascem nas calçadas perto do jogador e somem com o tempo.
  #updatePickups(dt) {
    if (this.player.isDead) return;
    updatePickups(this.pickups, dt, {
      px: this.player.x,
      py: this.player.y,
      isValidPoint: (x, y) => this.#isFreePickupPoint(x, y)
    });
    if (this.pickups.items.length === 0) return;

    const collector = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : this.player;
    if (!collector) return;
    for (const item of findPickupsInReach(this.pickups, collector.x, collector.y)) {
      const result = applyPickupEffect(item.type, { arsenal: this.arsenal, health: this.player.health, armor: this.armor });
      if (!result.consumed) continue;
      this.player.health = result.health;
      this.armor = result.armor;
      removePickup(this.pickups, item);
      this.hud.showToast(result.message);
      this.sound.play('pickup');
      if (item.type === 'medkit') this.hud.triggerHealFlash();
    }
  }

  // NPC que morreu (tiro, atropelamento, explosão...) solta dinheiro no chão.
  #updateCashDrops(dt) {
    const peds = this.trafficManager?.pedestrians || [];
    for (const ped of peds) {
      if (ped.state !== 'downed' || ped.cashDropped) continue;
      ped.cashDropped = true;
      this.cashDrops.push({
        x: ped.x,
        y: ped.y,
        amount: Number.isFinite(ped.cashValue) ? ped.cashValue : rollPedestrianCash(),
        age: 0
      });
    }

    if (this.cashDrops.length === 0) return;
    const collector = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : this.player;
    for (let i = this.cashDrops.length - 1; i >= 0; i--) {
      const drop = this.cashDrops[i];
      drop.age += dt;
      if (drop.age > CASH_DROP_LIFETIME) {
        this.cashDrops.splice(i, 1);
        continue;
      }
      if (!collector || this.player.isDead) continue;
      if (Math.hypot(collector.x - drop.x, collector.y - drop.y) <= CASH_PICKUP_RADIUS) {
        this.addMoney(drop.amount);
        this.hud.showToast(`+R$ ${drop.amount}`);
        this.cashDrops.splice(i, 1);
        this.#persistSaveState();
      }
    }
  }

  #renderExpandedMap() {
    this.minimap.renderExpanded(
      this.hud.expandedMapCanvas,
      this.cityMap,
      this.player,
      this.routePoints,
      this.objectivePoint,
      this.worldCollectibles,
      window.innerWidth,
      window.innerHeight,
      this.expandedMapView,
      this.encounterLocationCodes,
      { waypoint: this.waypoint, waypointRoutePoints: this.waypointRoutePoints },
    );
  }

  openExpandedMap() {
    if (this.hud.isExpandedMapOpen()) return;
    this.paused = true;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const objectiveText = this.freeRoamMode
      ? 'Exploração livre'
      : (activeMission?.objective || '');
    this.hud.openExpandedMap(objectiveText);
    this.#resetExpandedMapView();
    this.hud.animateExpandedMapOpen();
  }

  closeExpandedMap() {
    if (!this.hud.isExpandedMapOpen()) return;
    this.hud.closeExpandedMap();
    this.paused = false;
  }

  #handleResize() {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    if (this.hud.isExpandedMapOpen()) {
      this.#renderExpandedMap();
    }
  }

  start() {
    this.hud.showGameHud();
    this.running = true;
    this.lastTimestamp = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimestamp) / 1000));
      this.lastTimestamp = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  update(dt) {
    this.elapsedTime += dt;
    const input = this.input.update(dt);

    if (this.hud.isExpandedMapOpen()) {
      if (input.mapToggleJustPressed || input.secondaryJustPressed || input.pauseJustPressed) {
        this.closeExpandedMap();
        return;
      }
      if (input.resetZoomJustPressed) {
        this.#resetExpandedMapView();
        return;
      }
      let changed = false;
      const zoomDir = (input.zoomInPressed ? 1 : 0) - (input.zoomOutPressed ? 1 : 0);
      if (zoomDir !== 0) {
        this.#applyExpandedMapTransform({ type: 'zoom', factor: Math.exp(zoomDir * 1.8 * dt) });
        changed = true;
      }
      if (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05) {
        const zoom = Math.max(1, this.expandedMapView.zoom || 1);
        const panWorldSpeed = (this.cityMap.worldWidth * 0.42) / zoom;
        this.expandedMapView.centerX += input.moveX * panWorldSpeed * dt;
        this.expandedMapView.centerY += input.moveY * panWorldSpeed * dt;
        this.#clampExpandedMapView();
        if (!changed) this.#renderExpandedMap();
      }
      return;
    }

    if (input.mapToggleJustPressed && !this.player.isDead && !this.deathSequence && !this.cutscene?.active && !this.inventoryController?.isOpen && !this.hud.isMissionCompleteOpen() && !this.paused) {
      this.openExpandedMap();
      return;
    }

    if (input.pauseJustPressed && !this.player.isDead && !this.deathSequence && !this.cutscene?.active && !this.inventoryController?.isOpen && !this.hud.isMissionCompleteOpen() && !this.pauseMenu?.confirmDialog?.isOpen && !this.pauseMenu?.assetsRefreshDialog?.isOpen) {
      if (this.pauseMenu?.isOpen) this.pauseMenu.close();
      else this.pauseMenu?.open();
      return;
    }

    if (this.inventoryController?.isOpen) {
      this.inventoryController.updateInput(input);
      return;
    }

    if (this.paused) {
      if (this.hud.isMissionCompleteOpen()) {
        if (input.actionJustPressed) {
          this.hud.confirmMissionComplete();
        }
      } else {
        this.pauseMenu?.updateInput(input);
      }
      return;
    }

    if (this.cutscene?.active) {
      this.cutscene.updateInput(input);
      return;
    }

    if (this.player.isDead) {
      this.#updateParticles(dt);
      this.#updateExplosions(dt);
      if (input.actionJustPressed) {
        if (this.storyPackage && !this.freeRoamMode) {
          this.startMission(this.currentMissionIndex, { skipIntro: true });
        } else {
          this.resetMatch();
        }
      }
      return;
    }

    if (this.deathSequence) {
      this.input.setDrivingMode(false);
      this.deathSequence.timer += dt;
      const progress = Math.min(1, this.deathSequence.timer / this.deathSequence.duration);
      const timeScale = Math.max(0.03, Math.pow(1 - progress, 1.8));
      const scaledDt = dt * timeScale;

      this.hud?.setDeathDesaturation?.(progress);
      this.trafficManager.update(scaledDt, this.player, this.vehicles, this.trashBins, this.elapsedTime);

      const noInput = { moveX: 0, moveY: 0, actionPressed: false, secondaryPressed: false };
      for (const v of this.vehicles) {
        if (v.driver === 'npc') continue;
        if (Math.abs(v.x - this.player.x) > 1500) continue;
        updateVehicle(v, noInput, scaledDt, this.cityMap);
      }

      const nearbyVehicles = this.vehicles.filter(
        (v) => Math.abs(v.x - this.player.x) < 1200 && Math.abs(v.y - this.player.y) < 1200
      );
      this.#updateTrashBins(scaledDt, nearbyVehicles);
      this.#updateParticles(scaledDt);
      this.#updateExplosions(scaledDt);

      this.hud.updateStatus({
        locationCode: this.getLocationDisplayName(this.cityMap.getLocationAt(this.player.x, this.player.y)?.code || 'CIDADE'),
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: 0
      });

      if (this.deathSequence.timer >= this.deathSequence.duration) {
        this.#finalizeGameOver(this.deathSequence.reason);
      }
      return;
    }

    if (this.pendingGameOver) {
      this.pendingGameOver.timer += dt;
      this.#updateParticles(dt);
      this.#updateExplosions(dt);
      this.hud.updateStatus({
        locationCode: this.getLocationDisplayName(this.cityMap.getLocationAt(this.player.x, this.player.y)?.code || 'CIDADE'),
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: 0
      });
      if (this.pendingGameOver.timer >= this.pendingGameOver.duration && this.explosions.length === 0) {
        const reason = this.pendingGameOver.reason;
        this.pendingGameOver = null;
    this.deathSequence = null;
    this.hud?.setDeathDesaturation?.(0);
        this.triggerGameOver(reason);
      }
      return;
    }

    if (this.player.sinking.active) {
      const s = this.player.sinking;
      s.timer += dt;
      const progress = Math.min(1, s.timer / s.duration);
      const damp = Math.exp(-3.2 * dt);
      s.vx *= damp;
      s.vy *= damp;

      if (s.vehicleId) {
        const sv = this.vehicles.find((v) => v.id === s.vehicleId);
        if (sv) {
          sv.x += s.vx * dt;
          sv.y += s.vy * dt;
          sv.sinkProgress = progress;
          sv.sinkScale = 1 - progress * 0.72;
          sv.sinkAlpha = 1 - progress * 0.88;
          this.player.x = sv.x;
          this.player.y = sv.y;
        }
      } else {
        this.player.x += s.vx * dt;
        this.player.y += s.vy * dt;
        this.player.sinkProgress = progress;
        this.player.sinkScale = 1 - progress * 0.72;
        this.player.sinkAlpha = 1 - progress * 0.88;
      }

      this.hud.updateStatus({
        locationCode: 'ÁGUA',
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: this.player.health
      });

      if (progress >= 1) {
        this.player.sinking.active = false;
        this.applyDamage(this.player.health || 100, 'Você caiu na água nos limites da ilha!', { bypassResistance: true });
      }
      return;
    }

    let activeVehicle = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : null;

    if (!activeVehicle) {
      if (this.player.ejected.active) {
        const ejRes = updateEjectedPlayer(this.player, dt, this.cityMap, this.vehicles);
        if (this.player.speed > 35) {
          this.bloodMarks.push({
            x: this.player.x,
            y: this.player.y,
            size: 7,
            angle: this.player.angle,
            alpha: 0.72
          });
          if (this.bloodMarks.length > 260) {
            this.bloodMarks.shift();
          }
        }
        if (ejRes.extraDamage > 0) {
          this.bloodMarks.push(
            { x: this.player.x, y: this.player.y, size: 16, angle: this.player.angle, alpha: 0.88 },
            { x: this.player.x + 8, y: this.player.y - 6, size: 8, angle: 0, alpha: 0.78 },
            { x: this.player.x - 7, y: this.player.y + 7, size: 7, angle: 0, alpha: 0.78 }
          );
          this.applyDamage(Math.max(1, Math.round(ejRes.extraDamage * 0.75)), 'Você colidiu fortemente após ser ejetado!');
        }
        this.#resolvePlayerMissionNpcCollision();
      } else if (this.player.enteringVehicle) {
        const anim = this.player.enteringVehicle;
        const targetVehicle = this.vehicles.find((v) => v.id === anim.vehicleId);
        if (!targetVehicle || targetVehicle.destroyed) {
          this.player.enteringVehicle = null;
          this.player.entryScale = 1;
          this.player.entryAlpha = 1;
        } else {
          anim.timer += dt;
          const t = Math.min(1, anim.timer / anim.duration);
          const ease = 1 - Math.pow(1 - t, 2);
          this.player.x = anim.fromX + (targetVehicle.x - anim.fromX) * ease;
          this.player.y = anim.fromY + (targetVehicle.y - anim.fromY) * ease;
          this.player.angle = Math.atan2(targetVehicle.y - anim.fromY, targetVehicle.x - anim.fromX);
          this.player.walkPhase += dt * 22;
          this.player.speed = 90;
          if (targetVehicle.kind === 'moto') {
            this.player.entryScale = 1 + Math.sin(t * Math.PI) * 0.22;
            this.player.entryAlpha = 1;
          } else {
            this.player.entryScale = 1 - t * 0.35;
            this.player.entryAlpha = 1 - Math.max(0, (t - 0.55) / 0.45);
          }
          if (t >= 1) {
            this.player.enteringVehicle = null;
            this.player.entryScale = 1;
            this.player.entryAlpha = 1;
            this.player.inVehicleId = targetVehicle.id;
            this.player.x = targetVehicle.x;
            this.player.y = targetVehicle.y;
            this.player.insideLocationCode = null;
            targetVehicle.entryPulseTimer = 0.28;
            this.input.consumeExitTrigger();
            activeVehicle = targetVehicle;
          }
        }
      } else if (this.player.exitingVehicle) {
        const anim = this.player.exitingVehicle;
        anim.timer += dt;
        const t = Math.min(1, anim.timer / anim.duration);
        const ease = 1 - Math.pow(1 - t, 2);
        this.player.x = anim.fromX + (anim.toX - anim.fromX) * ease;
        this.player.y = anim.fromY + (anim.toY - anim.fromY) * ease;
        this.player.angle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
        this.player.walkPhase += dt * 22;
        this.player.speed = 90;
        if (anim.kind === 'moto') {
          this.player.entryScale = 1 + Math.sin(t * Math.PI) * 0.2;
          this.player.entryAlpha = 1;
        } else {
          this.player.entryScale = 0.65 + t * 0.35;
          this.player.entryAlpha = Math.min(1, t / 0.45);
        }
        if (t >= 1) {
          this.player.exitingVehicle = null;
          this.player.entryScale = 1;
          this.player.entryAlpha = 1;
          this.player.x = anim.toX;
          this.player.y = anim.toY;
        }
      } else {
        updatePedestrian(this.player, input, dt, this.cityMap, this.vehicles);
        this.#resolvePlayerMissionNpcCollision();
        if (this.player.speed > 5) {
          this.player.walkPhase += dt * 14;
        } else {
          this.player.walkPhase = 0;
        }
        this.#handleWeaponSwitch(input);
        const shopJustOpened = this.#updateShopInteraction(input);
        this.#updatePlayerAim(input);
        this.#handlePlayerWeaponInput(input);
        if (!shopJustOpened && (input.actionJustPressed || input.vehicleEnterJustPressed) && !this.#isNearInteriorStoryNpc()) {
          const encounterNpc = input.actionJustPressed ? this.#findNearbyEncounterNpc() : null;
          if (encounterNpc && this.cutscene) {
            this.player.speed = 0;
            this.cutscene.play(encounterNpc.cutscene, this.storyPackage.characters, (result) => {
              if (result?.outcome === 'gameover') {
                this.triggerGameOver(result.reason || 'Fim de linha!');
              }
            });
            return;
          }
          // Só a tecla F (ou o botão de ação no toque/gamepad) entra/rouba veículo; o Espaço apenas conversa.
          const nearest = input.vehicleEnterJustPressed
            ? findNearestVehicle(this.player.x, this.player.y, this.vehicles)
            : null;
          if (nearest) {
            const hadNpcDriver = nearest.driver === 'npc';
            if (hadNpcDriver) {
              this.trafficManager.evictDriver(nearest, this.player.radius);
            }
            nearest.driver = 'player';
            nearest.isParked = false;
            nearest.vx *= 0.25;
            nearest.vy *= 0.25;
            nearest.speed *= 0.25;
            this.player.insideLocationCode = null;
            this.player.enteringVehicle = {
              vehicleId: nearest.id,
              fromX: this.player.x,
              fromY: this.player.y,
              timer: 0,
              duration: hadNpcDriver ? 0.34 : 0.24,
              hadNpcDriver,
            };
          } else if (input.actionJustPressed) {
            const ped = this.#findNearestTalkablePedestrian(this.player.x, this.player.y);
            if (ped) {
              ped.angle = Math.atan2(this.player.y - ped.y, this.player.x - ped.x);
              const pool = this.storyPackage?.npcLines?.length ? this.storyPackage.npcLines : PEDESTRIAN_CHAT_LINES;
              const { line, scared } = pickChatLine({
                secondsSinceShot: this.combatClock - this.lastShotAt,
                health: this.player.health,
                armor: this.armor,
                insideShop: this.player.insideLocationCode === GUN_SHOP_CODE,
                money: this.money
              }, pool);
              const initPos = this.#worldToScreen(ped.x, ped.y - 22);
              this.hud.showNpcSpeechBubble(ped, line, initPos);
              if (scared) scarePedestrian(ped, this.player.x, this.player.y, 4);
            }
          }
        }
      }
    } else {
      const shouldExit =
        input.exitJustPressed ||
        input.comboExitJustPressed ||
        (input.canTriggerHoldExit && activeVehicle.speed < 25);

      if (shouldExit) {
        const exitPos = findSafeExitPosition(activeVehicle, this.player.radius, this.cityMap);
        const startX = activeVehicle.x;
        const startY = activeVehicle.y;
        const kind = activeVehicle.kind;
        activeVehicle.driver = null;
        activeVehicle.entryPulseTimer = 0.24;
        this.player.inVehicleId = null;
        this.player.x = startX;
        this.player.y = startY;
        this.player.exitingVehicle = {
          fromX: startX,
          fromY: startY,
          toX: exitPos.x,
          toY: exitPos.y,
          timer: 0,
          duration: 0.24,
          kind,
        };
        this.input.consumeExitTrigger();
        activeVehicle = null;
      }
    }

    this.input.setDrivingMode(Boolean(activeVehicle));

    this.#syncActiveChunks(this.player.x, this.player.y);
    this.trafficManager.update(dt, this.player, this.vehicles, this.trashBins, this.elapsedTime);
    this.boatManager?.update(dt);

    let maxPlayerImpact = 0;
    let playerHitBuilding = false;
    let impactMoveVx = activeVehicle ? activeVehicle.vx : 0;
    let impactMoveVy = activeVehicle ? activeVehicle.vy : 0;
    for (const v of this.vehicles) {
      if (v.driver === 'npc') continue;
      if (v.driver !== 'player' && Math.abs(v.x - this.player.x) > 1500) continue;
      const preVx = v.vx;
      const preVy = v.vy;
      const res = updateVehicle(v, input, dt, this.cityMap);
      if (v.driver === 'player' && res.impactSpeed > maxPlayerImpact) {
        maxPlayerImpact = res.impactSpeed;
        playerHitBuilding = Boolean(res.collided);
        impactMoveVx = preVx;
        impactMoveVy = preVy;
      }
      if (res.collided && res.impactSpeed > 75) {
        const dmgRes = applyVehicleDamage(v, res.impactSpeed);
        if (dmgRes.exploded) {
          this.#triggerVehicleExplosion(v);
        }
      }
      if (v.isDrifting && v.driftIntensity > 0.25) {
        this.#emitVehicleTireMarks(v, this.skidMarks, {
          alpha: Math.min(0.48, v.driftIntensity * 0.42),
          maxCount: 600,
          length: 9,
          includeSurface: true,
        });
      }
    }

    // Colisão veículo-veículo na área próxima ao jogador
    const nearbyVehicles = this.vehicles.filter(
      (v) => Math.abs(v.x - this.player.x) < 1200 && Math.abs(v.y - this.player.y) < 1200
    );
    for (let i = 0; i < nearbyVehicles.length; i++) {
      for (let j = i + 1; j < nearbyVehicles.length; j++) {
        const vA = nearbyVehicles[i];
        const vB = nearbyVehicles[j];
        const pairRes = resolveVehiclePairCollision(vA, vB);
        if (pairRes.collided && pairRes.impactSpeed > 75) {
          if (applyVehicleDamage(vA, pairRes.impactSpeed).exploded) {
            this.#triggerVehicleExplosion(vA);
          }
          if (applyVehicleDamage(vB, pairRes.impactSpeed).exploded) {
            this.#triggerVehicleExplosion(vB);
          }
        }
        if (pairRes.collided && (vA.driver === 'player' || vB.driver === 'player')) {
          if (pairRes.impactSpeed > maxPlayerImpact) {
            maxPlayerImpact = pairRes.impactSpeed;
          }
        }
      }
    }

    // Contagem regressiva de 10s para veículos com até 30% de integridade
    for (const v of this.vehicles) {
      if (v.entryPulseTimer > 0) {
        v.entryPulseTimer = Math.max(0, v.entryPulseTimer - dt);
      }
      if (v.destroyed) continue;
      const crit = updateVehicleCriticalState(v, dt);
      if (crit.shouldExplode) {
        this.#triggerVehicleExplosion(v);
      }
    }

    // Fumaça em veículos com <= 50% de integridade (cinza) e <= 30% (preta + faíscas de fogo)
    for (const v of nearbyVehicles) {
      if (!v.destroyed && (v.health ?? 100) <= 50) {
        const isCritical = (v.health ?? 100) <= 30;
        v.smokeTimer = (v.smokeTimer || 0) - dt;
        const interval = isCritical ? 0.026 : 0.07;
        if (v.smokeTimer <= 0) {
          v.smokeTimer = interval;
          const hoodX = v.x + Math.cos(v.angle) * (v.length * 0.28);
          const hoodY = v.y + Math.sin(v.angle) * (v.length * 0.28);
          this.smokeParticles.push({
            x: hoodX + (Math.random() - 0.5) * 6,
            y: hoodY + (Math.random() - 0.5) * 6,
            vx: -v.vx * 0.08 + (Math.random() - 0.5) * (isCritical ? 22 : 14),
            vy: -v.vy * 0.08 - (isCritical ? 12 : 6) + (Math.random() - 0.5) * 14,
            size: (isCritical ? 14 : 11) + Math.random() * 8,
            alpha: isCritical ? 0.88 : 0.52,
            dark: isCritical ? 0.05 : 0.58,
            life: 0,
            maxLife: isCritical ? 1.9 : 1.6
          });
          if (isCritical && Math.random() < 0.45) {
            const flamePalette = [
              [1, 0.9, 0.22],
              [1, 0.48, 0.06],
              [0.95, 0.16, 0.04]
            ];
            this.smokeParticles.push({
              x: hoodX + (Math.random() - 0.5) * 8,
              y: hoodY + (Math.random() - 0.5) * 8,
              vx: -v.vx * 0.05 + (Math.random() - 0.5) * 26,
              vy: -18 + (Math.random() - 0.5) * 18,
              size: 7 + Math.random() * 5,
              alpha: 0.95,
              color: flamePalette[Math.floor(Math.random() * flamePalette.length)],
              life: 0,
              maxLife: 0.35 + Math.random() * 0.2
            });
          }
          while (this.smokeParticles.length > 320) {
            this.smokeParticles.shift();
          }
        }
      } else if (v.destroyed && v.burning) {
        v.burnSmokeTimer = (v.burnSmokeTimer || 0) - dt;
        if (v.burnSmokeTimer <= 0) {
          v.burnSmokeTimer = 0.055;
          this.smokeParticles.push({
            x: v.x + (Math.random() - 0.5) * 18,
            y: v.y + (Math.random() - 0.5) * 18,
            vx: (Math.random() - 0.5) * 16,
            vy: -16 + (Math.random() - 0.5) * 12,
            size: 16 + Math.random() * 10,
            alpha: 0.86,
            dark: 0.05,
            life: 0,
            maxLife: 1.8
          });
          const flamePalette = [
            [1, 0.9, 0.2],
            [1, 0.46, 0.05],
            [0.96, 0.14, 0.04]
          ];
          this.smokeParticles.push({
            x: v.x + (Math.random() - 0.5) * 20,
            y: v.y + (Math.random() - 0.5) * 14,
            vx: (Math.random() - 0.5) * 18,
            vy: -20 - Math.random() * 14,
            size: 10 + Math.random() * 7,
            alpha: 0.95,
            color: flamePalette[Math.floor(Math.random() * flamePalette.length)],
            life: 0,
            maxLife: 0.4 + Math.random() * 0.25
          });
          while (this.smokeParticles.length > 320) {
            this.smokeParticles.shift();
          }
        }
      }
    }

    // Dano por contato com veículos em chamas na rua
    if (this.player.burnCooldown > 0) {
      this.player.burnCooldown = Math.max(0, this.player.burnCooldown - dt);
    }
    for (const v of nearbyVehicles) {
      if (v.burnCooldown > 0) {
        v.burnCooldown = Math.max(0, v.burnCooldown - dt);
      }
      if (!v.destroyed || !v.burning) continue;

      if (!this.player.inVehicleId && !this.player.isDead && !this.pendingGameOver && this.player.burnCooldown <= 0) {
        if (isTouchingVehicle(this.player.x, this.player.y, this.player.radius, v, 7)) {
          this.player.burnCooldown = 0.45;
          this.applyDamage(14, 'Você se queimou em um veículo em chamas!');
        }
      }

      if (this.trafficManager?.pedestrians) {
        for (const ped of this.trafficManager.pedestrians) {
          if (ped.state !== 'downed' && isTouchingVehicle(ped.x, ped.y, ped.radius || 9, v, 5)) {
            ped.state = 'downed';
            ped.runOver = true;
          }
        }
      }

      for (const other of nearbyVehicles) {
        if (other.id === v.id || other.destroyed || (other.burnCooldown || 0) > 0) continue;
        if (isTouchingVehicle(other.x, other.y, other.radius, v, 4)) {
          other.burnCooldown = 0.5;
          other.health = Math.max(0, (other.health ?? 100) - 8);
          if (other.health <= 0) {
            this.#triggerVehicleExplosion(other);
          }
        }
      }
    }

    this.#updateParticles(dt);
    this.#updateExplosions(dt);
    this.#updateCombat(dt);
    this.#updateCashDrops(dt);
    this.#updatePickups(dt);
    this.#updateWaypoint(dt);
    this.#updateTrashBins(dt, nearbyVehicles);

    if ((this.player.vehicleHitCooldown || 0) > 0) {
      this.player.vehicleHitCooldown = Math.max(0, this.player.vehicleHitCooldown - dt);
    }

    // Impacto de veículos no jogador a pé
    if (!activeVehicle && !this.player.isDead && !this.player.sinking.active && (this.player.vehicleHitCooldown || 0) <= 0) {
      for (const v of nearbyVehicles) {
        if (v.speed <= 25 || v.destroyed) continue;
        if (Math.abs(this.player.x - v.x) > 52 || Math.abs(this.player.y - v.y) > 52) continue;
        if (!isTouchingVehicle(this.player.x, this.player.y, this.player.radius || 12, v, 2)) continue;
        const movingTowardPlayer = (this.player.x - v.x) * v.vx + (this.player.y - v.y) * v.vy > 0;
        if (!movingTowardPlayer) continue;

        const dmg = Math.min(75, Math.max(5, Math.round((v.speed - 20) * 0.35)));
        const mag = Math.hypot(v.vx, v.vy) || 1;
        const knockDist = Math.min(22, Math.max(6, v.speed * 0.14));
        const kx = (v.vx / mag) * knockDist;
        const ky = (v.vy / mag) * knockDist;
        const playerRadius = this.player.radius || 12;
        const colliders = this.cityMap.getCollidersAround(this.player.x + kx, this.player.y + ky, 48);
        const resolved = resolveEntityCollisions(this.player.x + kx, this.player.y + ky, playerRadius, colliders);
        this.player.x = resolved.x;
        this.player.y = resolved.y;
        this.player.vehicleHitCooldown = 0.65;
        this.bloodMarks.push({
          x: this.player.x,
          y: this.player.y,
          size: 8 + Math.random() * 5,
          angle: Math.random() * Math.PI * 2,
          alpha: 0.72,
        });
        this.applyDamage(dmg, 'Você foi atropelado por um veículo!');
        break;
      }
    }

    // Impacto de veículos em pessoas andando ou fugindo na rua
    const standingPeds = this.trafficManager.pedestrians.filter((p) => p.state !== 'downed');
    for (const v of nearbyVehicles) {
      if (v.speed <= 18) continue;
      for (const ped of standingPeds) {
        if (ped.state === 'downed' || (ped.hitCooldown || 0) > 0) continue;
        if (Math.abs(ped.x - v.x) > 48 || Math.abs(ped.y - v.y) > 48) continue;
        if (isTouchingVehicle(ped.x, ped.y, ped.radius || 10, v, 2)) {
          const dmg = Math.min(100, Math.max(18, Math.round(v.speed * 0.45)));
          const hit = applyPedestrianDamage(ped, dmg, v.vx, v.vy);
          if (hit.damaged) {
            this.bloodMarks.push({
              x: ped.x,
              y: ped.y,
              size: hit.downed ? 16 : 10,
              angle: v.angle,
              alpha: hit.downed ? 0.85 : 0.65
            });
            v.bloodTireTimer = 1.6;
          }
        }
      }
    }

    // Atropelamento de pessoas caídas no chão: desloca o corpo e deixa trilha de sangue
    const downedPeds = this.trafficManager.pedestrians.filter((p) => p.state === 'downed');
    for (const v of nearbyVehicles) {
      if (v.speed > 12) {
        const hitRadius = Math.max(v.width, v.height) * 0.45;
        for (const ped of downedPeds) {
          if (Math.hypot(v.x - ped.x, v.y - ped.y) < hitRadius) {
            const vLen = Math.hypot(v.vx, v.vy) || 1;
            const pushSpeed = Math.max(140, v.speed * 1.15);
            ped.vx = (v.vx / vLen) * pushSpeed;
            ped.vy = (v.vy / vLen) * pushSpeed;
            if (!ped.runOver) {
              ped.runOver = true;
              this.bloodMarks.push({
                x: ped.x,
                y: ped.y,
                size: 16,
                angle: v.angle,
                alpha: 0.85
              });
            }
            v.bloodTireTimer = 1.8;
          }
        }
      }
      if (v.bloodTireTimer > 0) {
        v.bloodTireTimer = Math.max(0, v.bloodTireTimer - dt);
        if (v.speed > 12) {
          this.#emitVehicleTireMarks(v, this.bloodMarks, {
            alpha: Math.min(0.75, v.bloodTireTimer * 0.45),
            maxCount: 420,
            length: 7,
            includeSurface: false,
          });
        }
      }
    }

    for (const ped of downedPeds) {
      const pSpeed = Math.hypot(ped.vx || 0, ped.vy || 0);
      if (pSpeed > 10) {
        const nextX = ped.x + ped.vx * dt;
        const nextY = ped.y + ped.vy * dt;
        const colliders = this.cityMap.getCollidersAround(nextX, nextY, 80);
        const res = resolveEntityCollisions(nextX, nextY, 10, colliders);
        ped.x = res.x;
        ped.y = res.y;
        const damp = Math.exp(-4.8 * dt);
        ped.vx = res.collided ? -ped.vx * 0.3 : ped.vx * damp;
        ped.vy = res.collided ? -ped.vy * 0.3 : ped.vy * damp;
        this.bloodMarks.push({
          x: ped.x,
          y: ped.y,
          size: 8,
          angle: Math.atan2(ped.vy, ped.vx),
          alpha: 0.72
        });
        while (this.bloodMarks.length > 260) {
          this.bloodMarks.shift();
        }
      }
    }

    if (activeVehicle) {
      this.player.x = activeVehicle.x;
      this.player.y = activeVehicle.y;
      this.player.angle = activeVehicle.angle;

      const impact = evaluateVehicleImpact(maxPlayerImpact);
      if (impact.eject) {
        const moveLen = Math.hypot(impactMoveVx, impactMoveVy);
        let dirX = moveLen > 1 ? impactMoveVx / moveLen : Math.cos(activeVehicle.angle);
        let dirY = moveLen > 1 ? impactMoveVy / moveLen : Math.sin(activeVehicle.angle);
        if (playerHitBuilding) {
          dirX = -dirX;
          dirY = -dirY;
        }
        const ejectSpeed = Math.min(460, Math.max(240, maxPlayerImpact * 0.95));

        activeVehicle.driver = null;
        this.player.inVehicleId = null;
        const spawnX = activeVehicle.x + dirX * (activeVehicle.radius + this.player.radius + 4);
        const spawnY = activeVehicle.y + dirY * (activeVehicle.radius + this.player.radius + 4);
        const safeColliders = this.cityMap.getCollidersAround(spawnX, spawnY, 80);
        const safePos = resolveEntityCollisions(spawnX, spawnY, this.player.radius, safeColliders);
        this.player.x = safePos.x;
        this.player.y = safePos.y;
        this.player.angle = Math.atan2(dirY, dirX);
        this.player.ejected = {
          active: true,
          vx: dirX * ejectSpeed,
          vy: dirY * ejectSpeed,
          hitCooldown: 0.15,
          graceTimer: 0.25,
          sourceVehicleId: activeVehicle.id
        };
        this.input.consumeExitTrigger();
        this.applyDamage(Math.max(1, Math.round(impact.damage * 0.7)), 'Você sofreu uma colisão fatal!');
      }
    }

    if (isInWater(this.player.x, this.player.y, this.cityMap) && !this.player.sinking.active && !this.player.isDead) {
      const sv = this.player.inVehicleId
        ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
        : null;
      this.hud.triggerDamageFlash();
      this.player.sinking = {
        active: true,
        timer: 0,
        duration: 1.35,
        vehicleId: sv ? sv.id : null,
        vx: sv ? sv.vx * 0.45 : Math.cos(this.player.angle) * 90,
        vy: sv ? sv.vy * 0.45 : Math.sin(this.player.angle) * 90
      };
    }

    const loc = this.cityMap.getLocationAt(this.player.x, this.player.y);
    this.player.currentLocationCode = loc ? loc.code : 'CIDADE';
    this.player.insideLocationCode =
      !this.player.inVehicleId && loc && (loc.type === 'house' || loc.type === 'commerce' || loc.type === 'hospital')
        ? loc.code
        : null;

    const isInsideHospital = Boolean(!this.player.inVehicleId && loc && loc.type === 'hospital');
    if (isInsideHospital && !this.wasInsideHospital && this.player.health < 100) {
      this.player.health = 100;
      this.hud.triggerHealFlash();
      this.hud.showToast('Vida recuperada no hospital!');
    }
    this.wasInsideHospital = isInsideHospital;

    if (this.collectibleFullToastCooldown > 0) {
      this.collectibleFullToastCooldown = Math.max(0, this.collectibleFullToastCooldown - dt);
    }
    for (const c of this.worldCollectibles) {
      if (c.collected || this.inventory.hasItem(c.id)) {
        c.collected = true;
        this.collectedExtraIds.add(c.id);
        continue;
      }
      if (c.kind === 'interior' && this.player.insideLocationCode !== c.locationCode) continue;
      if (Math.hypot(this.player.x - c.x, this.player.y - c.y) <= 44) {
        if (this.inventory.isFull()) {
          if (this.collectibleFullToastCooldown <= 0) {
            this.hud.showToast(`Inventário cheio! Libere espaço para pegar ${c.name}.`);
            this.collectibleFullToastCooldown = 3.0;
          }
          continue;
        }
        c.collected = true;
        this.collectedExtraIds.add(c.id);
        this.#grantMissionItem(c.id);
        const screenPos = this.#worldToScreen(c.x, c.y);
        this.hud.animatePickupToInventory(screenPos.x, screenPos.y, c.imageUrl, c.name);
        this.hud.showToast(`${c.name} — ${c.description}`, {
          imageUrl: c.imageUrl,
          imageAlt: c.name
        });
      }
    }

    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const reachedPickup =
      !this.itemPickedUp &&
      activeMission?.pickupLocation &&
      this.objectivePoint &&
      (Math.hypot(this.player.x - this.objectivePoint.x, this.player.y - this.objectivePoint.y) < 76 ||
        this.player.insideLocationCode === activeMission.pickupLocation);

    if (reachedPickup) {
      this.itemPickedUp = true;
      const itemDef = this.storyPackage?.items?.get(activeMission.giveItem);
      const itemName = itemDef?.name || 'Item';
      if (this.objectivePoint && itemDef?.imageUrl) {
        const screenPos = this.#worldToScreen(this.objectivePoint.x, this.objectivePoint.y);
        this.hud.updateWorldPickupItem(false);
        this.hud.animatePickupToInventory(screenPos.x, screenPos.y, itemDef.imageUrl, itemName);
      }
      if (activeMission.giveItem && !this.inventory.hasItem(activeMission.giveItem)) {
        this.#grantMissionItem(activeMission.giveItem);
      }
      const targetName = this.locationNames.get(activeMission.targetLocation) || activeMission.targetLocation;
      this.hud.showToast(`${itemName} guardada no inventário! Leve até ${targetName}.`, {
        imageUrl: itemDef?.imageUrl || '',
        imageAlt: itemName
      });
      this.setObjective(activeMission.targetLocation);
      this.#persistSaveState();
    } else {
      const requiresBuildingEntry =
        this.objectiveLocationType === 'commerce' || this.objectiveLocationType === 'house';
      const reachedTarget =
        this.objectivePoint &&
        (requiresBuildingEntry
          ? this.#isNearInteriorStoryNpc() && input.actionJustPressed
          : Math.hypot(this.player.x - this.objectivePoint.x, this.player.y - this.objectivePoint.y) < 76 ||
            Boolean(activeMission && this.player.insideLocationCode === activeMission.targetLocation));

      if (this.awaitingExitTarget) {
        if (!reachedTarget || (requiresBuildingEntry && input.actionJustPressed)) {
          this.awaitingExitTarget = false;
        }
      }
      if (!this.awaitingExitTarget && this.objectivePoint && !this.missionOutTriggered && reachedTarget) {
        if (this.storyPackage && !this.freeRoamMode) {
          this.missionOutTriggered = true;
          this.#handleMissionArrival();
        } else {
          this.setObjective(null);
        }
      }
    }

    this.routeTimer += dt;
    if (this.objectiveCode && this.routeTimer >= 0.25) {
      this.routeTimer = 0;
      this.routePoints = this.pathfinder.findRoute(this.player.x, this.player.y, this.objectiveCode);
    }

    const nearbyBlocks = this.cityMap.getVisibleBlocks(
      this.player.x - 400,
      this.player.y - 400,
      this.player.x + 400,
      this.player.y + 400
    );
    for (const block of nearbyBlocks) {
      for (const b of block.buildings) {
        const ex = b.entrance.x + b.entrance.w * 0.5;
        const ey = b.entrance.y + b.entrance.h * 0.5;
        const nearDoor = !this.player.inVehicleId && Math.hypot(this.player.x - ex, this.player.y - ey) < 42;
        const targetOpen = nearDoor ? 1 : 0;
        b.doorOpen = (b.doorOpen || 0) + (targetOpen - (b.doorOpen || 0)) * Math.min(1, dt * 12);
        const targetRoofAlpha = !this.player.inVehicleId && this.player.insideLocationCode === b.code ? 0 : 1;
        const currRoofAlpha = b.roofAlpha ?? 1;
        const nextRoofAlpha = currRoofAlpha + (targetRoofAlpha - currRoofAlpha) * Math.min(1, dt * 10);
        b.roofAlpha = nextRoofAlpha < 0.01 ? 0 : nextRoofAlpha > 0.99 ? 1 : nextRoofAlpha;
      }
    }

    this.camera.x += (this.player.x - this.camera.x) * Math.min(1, dt * 10);
    this.camera.y += (this.player.y - this.camera.y) * Math.min(1, dt * 10);

    const currentVehicle = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : null;

    const nearbyEncounterNpc = this.#findNearbyEncounterNpc();
    const objectiveHint = this.#isNearInteriorStoryNpc()
      ? 'Aperte Ação para falar'
      : nearbyEncounterNpc
        ? (nearbyEncounterNpc.prompt || 'Aperte Ação para falar')
        : this.getLocationDisplayName(this.objectiveCode);

    if (this.hudDisplayHealth < this.player.health) {
      this.hudDisplayHealth = Math.min(this.player.health, this.hudDisplayHealth + dt * 90);
    } else {
      this.hudDisplayHealth = this.player.health;
    }

    this.hud.updateStatus({
      locationCode: this.getLocationDisplayName(this.player.currentLocationCode),
      vehicle: currentVehicle,
      isDrifting: Boolean(currentVehicle?.isDrifting),
      objectiveCode: objectiveHint,
      health: this.hudDisplayHealth,
      weaponLabel: currentVehicle ? null : this.#getWeaponHudLabel(),
      money: this.money,
      armor: this.armor
    });
  }

  // Teclas 1-5 e roda do mouse trocam a arma da mão.
  #handleWeaponSwitch(input) {
    if (!this.arsenal || this.player.isDead) return;
    let changed = null;
    if (input.weaponSlotJustPressed !== null && input.weaponSlotJustPressed !== undefined) {
      changed = equipSlot(this.arsenal, input.weaponSlotJustPressed);
    }
    if (input.weaponCycle) {
      changed = cycleWeapon(this.arsenal, input.weaponCycle) || changed;
    }
    this.player.weapon = getEquipped(this.arsenal);
    if (changed) {
      this.hud.showToast(getWeaponDef(changed.id).name, 1200);
      this.sound.play('switch');
    }
  }

  #getShopCounter() {
    if (this.shopCounter === undefined) {
      const shop = this.cityMap.resolveLocationCode(GUN_SHOP_CODE);
      this.shopCounter = shop?.interior?.props?.find((p) => p.kind === 'counter') || null;
    }
    return this.shopCounter;
  }

  #isNearShopCounter() {
    if (this.player.inVehicleId || this.player.isDead) return false;
    if (this.player.insideLocationCode !== GUN_SHOP_CODE) return false;
    const counter = this.#getShopCounter();
    if (!counter) return false;
    const nearestX = Math.max(counter.x, Math.min(this.player.x, counter.x + counter.w));
    const nearestY = Math.max(counter.y, Math.min(this.player.y, counter.y + counter.h));
    return Math.hypot(this.player.x - nearestX, this.player.y - nearestY) < SHOP_COUNTER_REACH;
  }

  #updateShopInteraction(input) {
    const near = this.#isNearShopCounter();
    this.shopMenu.setPromptVisible(near);
    if (near && input.actionJustPressed) {
      this.shopMenu.open({
        title: GUN_SHOP_NAME,
        offers: describeOffers(this.arsenal, this.money),
        money: this.money
      });
      return true;
    }
    return false;
  }

  #buyShopItem(itemId) {
    const result = purchaseItem(itemId, this.arsenal, this.money);
    if (result.ok) {
      this.money = result.money;
      this.player.weapon = getEquipped(this.arsenal);
      this.sound.play('pickup');
      this.#persistSaveState();
    }
    this.shopMenu.refresh({
      offers: describeOffers(this.arsenal, this.money),
      money: this.money,
      message: result.message,
      ok: result.ok
    });
  }

  addMoney(amount) {
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value)) return;
    this.money = Math.max(0, this.money + value);
  }

  #runCheat(value) {
    const result = applyCheat(value, {
      addMoney: (n) => this.addMoney(n),
      addAmmo: (n) => (this.player.weapon ? addAmmo(this.player.weapon, n) : 0),
      healPlayer: () => { this.player.health = 100; },
      fillArmor: () => { this.armor = 100; },
      toggleMute: () => this.sound.toggleMute()
    });
    if (result.ok) this.#persistSaveState();
    return result;
  }

  #toggleCheatConsole() {
    if (!this.cheatConsole) return;
    if (this.cheatConsole.isOpen) {
      this.cheatConsole.close();
      return;
    }
    if (this.paused || this.inventoryController?.isOpen || this.hud.isExpandedMapOpen() || this.pauseMenu?.isOpen) return;
    this.cheatConsole.open();
  }

  // Converte um ponto da tela (coordenadas do mouse) em ponto do mundo, pela mesma matriz do renderer.
  #screenToWorld(clientX, clientY) {
    const zoom = this.renderer?.zoom || 1;
    const viewW = this.renderer?.viewWidth || window.innerWidth || 800;
    const viewH = this.renderer?.viewHeight || window.innerHeight || 600;
    const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: viewW, height: viewH };
    const sx = (clientX - rect.left) * (viewW / (rect.width || viewW));
    const sy = (clientY - rect.top) * (viewH / (rect.height || viewH));
    return {
      x: this.camera.x + (sx - viewW * 0.5) / zoom,
      y: this.camera.y + (sy - viewH * 0.5) / zoom
    };
  }

  #isTargetable(ped) {
    return Boolean(ped) && ped.state !== 'downed' && !ped.isDead && !ped.knockedDown && !(ped.health <= 0);
  }

  #pedestrianNear(peds, x, y, pickRadius) {
    let best = null;
    let bestDist = Infinity;
    for (const ped of peds) {
      if (!this.#isTargetable(ped)) continue;
      const d = Math.hypot(ped.x - x, ped.y - y);
      if (d <= pickRadius + (ped.radius || 10) && d < bestDist) {
        best = ped;
        bestDist = d;
      }
    }
    return best;
  }

  #nextLockTarget(peds) {
    const candidates = peds
      .filter((ped) => this.#isTargetable(ped) && Math.hypot(ped.x - this.player.x, ped.y - this.player.y) <= LOCK_CYCLE_RANGE)
      .sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y));
    if (candidates.length === 0) return null;
    const currentIdx = candidates.indexOf(this.lockedTarget);
    return candidates[(currentIdx + 1) % candidates.length];
  }

  // Define para onde o jogador olha/atira: alvo fixado > mouse > direção do movimento (padrão).
  #updatePlayerAim(input) {
    const peds = this.trafficManager?.pedestrians || [];

    if (input.lockNearestJustPressed) this.lockedTarget = this.#nextLockTarget(peds);
    if (input.lockClick) {
      const w = this.#screenToWorld(input.lockClick.clientX, input.lockClick.clientY);
      this.lockedTarget = this.#pedestrianNear(peds, w.x, w.y, LOCK_PICK_RADIUS);
    }

    const target = this.lockedTarget;
    if (target) {
      const tooFar = Math.hypot(target.x - this.player.x, target.y - this.player.y) > LOCK_MAX_RANGE;
      if (!peds.includes(target) || !this.#isTargetable(target) || tooFar) {
        this.lockedTarget = null;
      }
    }

    if (this.lockedTarget) {
      this.player.angle = Math.atan2(this.lockedTarget.y - this.player.y, this.lockedTarget.x - this.player.x);
    } else if (input.mouseAim?.active) {
      const w = this.#screenToWorld(input.mouseAim.clientX, input.mouseAim.clientY);
      this.player.angle = Math.atan2(w.y - this.player.y, w.x - this.player.x);
    }
  }

  #getWeaponHudLabel() {
    const weapon = this.player.weapon;
    if (!weapon) return null;
    if (isReloading(weapon)) return 'Recarregando...';
    return `${getWeaponDef(weapon.id).shortName} ${weapon.ammoInMag}/${weapon.ammoReserve}`;
  }

  #handlePlayerWeaponInput(input) {
    const weapon = this.player.weapon;
    if (!weapon || this.player.isDead) return;

    if (input.reloadJustPressed && startReload(weapon)) {
      this.sound.play('reload');
    }
    if (input.firePressed) {
      const wasReloading = isReloading(weapon);
      const fired = tryFireBullets(weapon, this.player.x, this.player.y, this.player.angle);
      if (fired.length > 0) {
        for (const bullet of fired) {
          this.bullets.push(bullet);
        }
        this.#onWeaponFired(weapon);
      } else if (!wasReloading && isReloading(weapon)) {
        this.sound.play('reload'); // pente vazio: recarga automática
      } else if (!wasReloading && weapon.ammoInMag <= 0 && weapon.ammoReserve <= 0 && this.emptyClickCooldown <= 0) {
        this.emptyClickCooldown = 0.35;
        this.sound.play('empty');
      }
    }
  }

  // Efeitos de um disparo: som, cápsula no chão, tremida de câmera e pedestres assustados.
  #onWeaponFired(weapon) {
    const def = getWeaponDef(weapon.id);
    this.lastShotAt = this.combatClock;
    this.sound.play(weapon.id);
    spawnCasing(this.casings, this.player.x, this.player.y, this.player.angle, def.casingColor);
    this.shakeTimer = Math.max(this.shakeTimer || 0, def.shake);
    scareNearbyPedestrians(this.trafficManager?.pedestrians, this.player.x, this.player.y, def.noise);
  }

  #updateCombat(dt) {
    this.combatClock += dt;
    this.emptyClickCooldown = Math.max(0, this.emptyClickCooldown - dt);
    updateCasings(this.casings, dt);
    if (this.player.inVehicleId) {
      this.lockedTarget = null;
      this.shopMenu?.setPromptVisible(false);
    }
    const weapon = this.player.weapon;
    if (weapon) {
      updateWeaponState(weapon, dt);
    }
    if (this.bullets.length === 0) return;

    const peds = this.trafficManager?.pedestrians || [];
    const colliders = this.cityMap.getCollidersAround(this.player.x, this.player.y, 640);
    const events = updateBullets(this.bullets, dt, {
      colliders,
      pedestrians: peds,
      vehicleAt: (x, y) => {
        for (const v of this.vehicles) {
          if (v.destroyed || v.id === this.player.inVehicleId) continue;
          if (Math.abs(v.x - x) > 48 || Math.abs(v.y - y) > 48) continue;
          if (isTouchingVehicle(x, y, 2, v, 0)) return v;
        }
        return null;
      }
    });

    for (const ev of events) {
      if (ev.type === 'pedestrian') {
        const ped = ev.target;
        ped.hitCooldown = 0; // cada tiro conta, mesmo em sequência rápida
        const hit = applyPedestrianDamage(ped, ev.bullet.damage, ev.bullet.dirX * 140, ev.bullet.dirY * 140);
        if (hit.damaged) {
          this.bloodMarks.push({
            x: ped.x,
            y: ped.y,
            size: hit.downed ? 14 : 8,
            angle: ev.bullet.angle,
            alpha: hit.downed ? 0.8 : 0.6
          });
        }
      } else {
        this.#spawnBulletSparks(ev.x, ev.y, ev.bullet.angle);
        if (ev.type === 'vehicle') this.#damageVehicleFromBullet(ev.target, ev.bullet.damage);
      }
    }
  }

  // Bala em carro: tira vida; abaixo de 30% ele solta fumaça (e explode depois de um tempo), a 0 explode na hora.
  #damageVehicleFromBullet(vehicle, bulletDamage) {
    if (!vehicle || vehicle.destroyed) return;
    vehicle.health = Math.max(0, (vehicle.health ?? 100) - bulletDamage * VEHICLE_BULLET_FACTOR);
    if (vehicle.health <= 0) this.#triggerVehicleExplosion(vehicle);
  }

  #spawnBulletSparks(x, y, bulletAngle) {
    for (let i = 0; i < 4; i++) {
      const spread = bulletAngle + Math.PI + (Math.random() - 0.5) * 1.6;
      const speed = 60 + Math.random() * 90;
      this.smokeParticles.push({
        x,
        y,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        life: 0,
        maxLife: 0.16 + Math.random() * 0.1,
        size: 3,
        alpha: 0.95,
        color: [1, 0.85, 0.45]
      });
    }
  }

  #updateParticles(dt) {
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    }
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.smokeParticles.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-2.0 * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += 12 * dt;
    }
  }

  #updateTrashBins(dt, nearbyVehicles) {
    if (!this.trashBins || this.trashBins.length === 0) return;

    for (const bin of this.trashBins) {
      for (const v of nearbyVehicles) {
        if (v.speed <= 12) continue;
        if (Math.abs(bin.x - v.x) > 48 || Math.abs(bin.y - v.y) > 48) continue;
        if (isTouchingVehicle(bin.x, bin.y, bin.radius, v, 1)) {
          hitTrashBin(bin, v.vx, v.vy, v.x, v.y);
        }
      }

      if (!this.player.inVehicleId && !this.player.isDead && this.player.speed > 10) {
        const d = Math.hypot(bin.x - this.player.x, bin.y - this.player.y);
        if (d < bin.radius + this.player.radius) {
          const pvx = Math.cos(this.player.angle) * this.player.speed * 0.85;
          const pvy = Math.sin(this.player.angle) * this.player.speed * 0.85;
          hitTrashBin(bin, pvx, pvy, this.player.x, this.player.y, 75);
        }
      }

      if (bin.vx !== 0 || bin.vy !== 0 || bin.angVel !== 0) {
        updateTrashBin(bin, dt, this.cityMap);
        const binSpeed = Math.hypot(bin.vx, bin.vy);
        if (binSpeed > 45 && this.trafficManager?.pedestrians) {
          for (const ped of this.trafficManager.pedestrians) {
            if (ped.state === 'downed' || (ped.hitCooldown || 0) > 0) continue;
            if (Math.hypot(ped.x - bin.x, ped.y - bin.y) <= bin.radius + (ped.radius || 10)) {
              const dmg = Math.min(85, Math.max(15, Math.round(binSpeed * 0.22)));
              const hit = applyPedestrianDamage(ped, dmg, bin.vx, bin.vy);
              if (hit.damaged) {
                if (hit.downed || dmg >= 35) {
                  this.bloodMarks.push({
                    x: ped.x,
                    y: ped.y,
                    size: hit.downed ? 14 : 9,
                    angle: Math.atan2(bin.vy, bin.vx),
                    alpha: 0.72
                  });
                }
                bin.vx *= -0.45;
                bin.vy *= -0.45;
              }
            }
          }
        }
      }
    }
  }

  #updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.timer += dt;

      const shockProgress = Math.min(1, ex.timer / ex.shockDuration);
      const shockEase = 1 - Math.pow(1 - shockProgress, 2.2);
      ex.shockRadius = ex.shockMaxRadius * shockEase;

      if (!ex.shockDone) {
        if (!ex.hitIds.has('player') && this.player.inVehicleId == null) {
          const pDist = Math.hypot(this.player.x - ex.x, this.player.y - ex.y);
          if (pDist <= ex.shockRadius) {
            ex.hitIds.add('player');
            const dmg = computeShockwaveDamage(pDist, ex.shockMaxRadius, 95);
            if (dmg > 0) {
              this.applyDamage(dmg, 'Você foi atingido pelo deslocamento de ar da explosão!');
            }
          }
        }

        if (this.trafficManager?.pedestrians) {
          for (const ped of this.trafficManager.pedestrians) {
            const key = `ped:${ped.id}`;
            if (ex.hitIds.has(key)) continue;
            const d = Math.hypot(ped.x - ex.x, ped.y - ex.y);
            if (d <= ex.shockRadius) {
              ex.hitIds.add(key);
              const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
              if (strength > 0) {
                const ang = Math.atan2(ped.y - ex.y, ped.x - ex.x);
                ped.vx = Math.cos(ang) * 240 * strength;
                ped.vy = Math.sin(ang) * 240 * strength;
                if (strength >= 0.25) {
                  ped.state = 'downed';
                  ped.runOver = true;
                  this.bloodMarks.push({
                    x: ped.x,
                    y: ped.y,
                    size: 14,
                    angle: ang,
                    alpha: 0.82
                  });
                }
              }
            }
          }
        }

        for (const other of this.vehicles) {
          if (other.id === ex.sourceVehicleId || other.destroyed) continue;
          const key = `veh:${other.id}`;
          if (ex.hitIds.has(key)) continue;
          const d = Math.hypot(other.x - ex.x, other.y - ex.y);
          if (d <= ex.shockRadius) {
            ex.hitIds.add(key);
            const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
            if (strength > 0) {
              const ang = Math.atan2(other.y - ex.y, other.x - ex.x);
              other.vx += Math.cos(ang) * 190 * strength;
              other.vy += Math.sin(ang) * 190 * strength;
              const splashSpeed = Math.round(340 * strength);
              if (applyVehicleDamage(other, splashSpeed, 35).exploded) {
                this.#triggerVehicleExplosion(other);
              }
            }
          }
        }

        if (this.trashBins) {
          for (const bin of this.trashBins) {
            const key = `bin:${bin.id}`;
            if (ex.hitIds.has(key)) continue;
            const d = Math.hypot(bin.x - ex.x, bin.y - ex.y);
            if (d <= ex.shockRadius) {
              ex.hitIds.add(key);
              const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
              if (strength > 0) {
                const ang = Math.atan2(bin.y - ex.y, bin.x - ex.x);
                hitTrashBin(bin, Math.cos(ang) * 280 * strength, Math.sin(ang) * 280 * strength, ex.x, ex.y, 120 * strength);
              }
            }
          }
        }

        if (shockProgress >= 1) {
          ex.shockDone = true;
        }
      }

      if (ex.timer >= ex.duration) {
        this.explosions.splice(i, 1);
      }
    }
  }

  render() {
    const shakeAmp = this.shakeTimer > 0 ? this.shakeTimer * 18 : 0;
    const renderCam =
      shakeAmp > 0
        ? {
            x: this.camera.x + (Math.random() - 0.5) * shakeAmp,
            y: this.camera.y + (Math.random() - 0.5) * shakeAmp
          }
        : this.camera;
    const isPickupStage = this.#isPickupStageActive();
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const pickupItemDef = isPickupStage ? this.storyPackage?.items?.get(activeMission.giveItem) : null;

    const hideTargetNpc = isPickupStage || this.missionOutTriggered || this.freeRoamMode;
    this.renderer.renderFrame({
      camera: renderCam,
      cityMap: this.cityMap,
      vehicles: this.vehicles,
      boats: this.boatManager ? this.boatManager.boats : [],
      trashBins: this.trashBins || [],
      pedestrians: this.trafficManager ? this.trafficManager.pedestrians : [],
      player: this.player,
      skidMarks: this.skidMarks,
      bloodMarks: this.bloodMarks,
      cashDrops: this.cashDrops,
      pickups: this.pickups.items,
      casings: this.casings,
      bullets: this.bullets,
      lockTarget: this.lockedTarget,
      smokeParticles: this.smokeParticles,
      explosions: this.explosions,
      worldCollectibles: this.worldCollectibles,
      objectivePoint: hideTargetNpc ? null : this.objectivePoint,
      objectiveNpcPoint: hideTargetNpc ? null : this.objectiveNpcPoint,
      completedNpcPoints: [...this.completedNpcPoints, ...this.encounterNpcs],
      encounterLocations: this.encounterLocationCodes,
      emitNpcWaves: !hideTargetNpc && Boolean(this.objectiveNpcPoint || this.objectivePoint),
      time: this.elapsedTime
    });
    if (isPickupStage && pickupItemDef?.imageUrl && !this.cutscene?.active && !this.paused && !this.player.isDead) {
      const screenPos = this.#worldToScreen(this.objectivePoint.x, this.objectivePoint.y);
      this.hud.updateWorldPickupItem(true, screenPos.x, screenPos.y, pickupItemDef.imageUrl, pickupItemDef.name);
    } else {
      this.hud.updateWorldPickupItem(false);
    }

    if (!this.cutscene?.active && !this.paused && !this.player.isDead) {
      const visibleCollectibles = [];
      for (const c of this.worldCollectibles) {
        if (c.collected || !c.imageUrl) continue;
        if (c.kind === 'interior' && this.player.insideLocationCode !== c.locationCode) continue;
        if (Math.abs(c.x - renderCam.x) > 1000 || Math.abs(c.y - renderCam.y) > 800) continue;
        const pos = this.#worldToScreen(c.x, c.y);
        visibleCollectibles.push({
          screenX: pos.x,
          screenY: pos.y,
          imageUrl: c.imageUrl,
          name: c.name
        });
      }
      this.hud.updateWorldCollectibles(visibleCollectibles);
    } else {
      this.hud.updateWorldCollectibles([]);
    }
    this.hud.updateNpcSpeechBubbles?.((bubblePed) => {
      const closeBelowPlayer =
        !this.player.inVehicleId &&
        bubblePed.y > this.player.y &&
        bubblePed.y - this.player.y < 52 &&
        Math.abs(bubblePed.x - this.player.x) < 58;
      const avoidX = closeBelowPlayer
        ? (bubblePed.x >= this.player.x ? 34 : -34)
        : 0;
      return this.#worldToScreen(bubblePed.x + avoidX, bubblePed.y - 22);
    });
    this.minimap.render(
      this.cityMap,
      this.player,
      this.routePoints,
      this.objectivePoint,
      this.worldCollectibles,
      this.encounterLocationCodes,
      { waypoint: this.waypoint, waypointRoutePoints: this.waypointRoutePoints },
    );
    if (this.hud.isExpandedMapOpen()) {
      this.#renderExpandedMap();
    }
  }

  #emitVehicleTireMarks(vehicle, targetArray, { alpha, maxCount, length = 8, includeSurface = false }) {
    if (!vehicle || !Array.isArray(targetArray)) return;
    const cos = Math.cos(vehicle.angle);
    const sin = Math.sin(vehicle.angle);
    const rearX = vehicle.x - cos * ((vehicle.length || 44) * 0.28);
    const rearY = vehicle.y - sin * ((vehicle.length || 44) * 0.28);
    const wheelOffsets = vehicle.kind === 'moto' ? [0] : [-1, 1];
    const trackHalf = (vehicle.width || 24) * 0.34;
    const tireWidth = vehicle.kind === 'van' ? 5 : 4;

    for (const side of wheelOffsets) {
      const wx = rearX + (-sin) * trackHalf * side;
      const wy = rearY + cos * trackHalf * side;
      targetArray.push({
        x: wx,
        y: wy,
        angle: vehicle.angle,
        alpha,
        width: tireWidth,
        length,
        size: tireWidth,
        surface: includeSurface && this.cityMap?.getSurfaceAt ? this.cityMap.getSurfaceAt(wx, wy) : undefined,
      });
    }
    while (targetArray.length > maxCount) {
      targetArray.shift();
    }
  }

  #triggerVehicleExplosion(vehicle) {
    if (!vehicle || vehicle.destroyed) return;
    vehicle.destroyed = true;
    vehicle.burning = true;
    vehicle.burnSmokeTimer = 0;
    vehicle.health = 0;
    vehicle.criticalTimer = 0;
    vehicle.driver = null;
    vehicle.vx = 0;
    vehicle.vy = 0;
    vehicle.speed = 0;
    vehicle.isDrifting = false;

    const blastRadius = 155;
    const shockMaxRadius = 215;
    const shockDuration = 0.62;
    const lobes = [];
    for (let i = 0; i < 7; i++) {
      lobes.push({
        angle: (Math.PI * 2 * i) / 7 + (Math.random() - 0.5) * 0.45,
        distScale: 0.28 + Math.random() * 0.42,
        sizeScale: 0.62 + Math.random() * 0.42,
        delay: Math.random() * 0.14
      });
    }
    const sparks = [];
    for (let i = 0; i < 18; i++) {
      sparks.push({
        angle: (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.35,
        speed: 0.75 + Math.random() * 0.75,
        size: 5 + Math.random() * 5
      });
    }

    const hitIds = new Set();
    if (this.player.inVehicleId === vehicle.id) {
      this.player.inVehicleId = null;
      this.player.health = 0;
      this.player.sinkAlpha = 0;
      this.hud.triggerDamageFlash();
      hitIds.add('player');
      this.triggerGameOver('Seu veículo explodiu!');
    }

    this.shakeTimer = 0.55;
    this.sound.play('explosion', Math.max(0.15, 1 - Math.hypot(vehicle.x - this.player.x, vehicle.y - this.player.y) / 1600));
    this.explosions.push({
      x: vehicle.x,
      y: vehicle.y,
      sourceVehicleId: vehicle.id,
      timer: 0,
      duration: 1.35,
      radius: blastRadius,
      shockMaxRadius,
      shockDuration,
      shockRadius: 0,
      shockDone: false,
      hitIds,
      lobes,
      sparks
    });

    this.#emitVehicleTireMarks(vehicle, this.skidMarks, {
      alpha: 0.78,
      maxCount: 600,
      length: 12,
      includeSurface: true,
    });

    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.25;
      const spd = 40 + Math.random() * 75;
      this.smokeParticles.push({
        x: vehicle.x,
        y: vehicle.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 16,
        size: 16 + Math.random() * 14,
        alpha: 0.88,
        dark: 0.12,
        life: 0,
        maxLife: 1.25 + Math.random() * 0.45
      });
    }
  }
}
