import { Engine } from './core/engine.js?v=59';
import { HudController } from './ui/hud-controller.js?v=43';
import { CutsceneController } from './ui/cutscene-controller.js?v=15';
import { PauseMenuController } from './ui/pause-menu.js?v=6';
import { ConfirmDialogController } from './ui/confirm-dialog.js?v=2';
import { AssetsRefreshDialogController } from './ui/assets-refresh-dialog.js?v=2';
import { InventoryController } from './ui/inventory-controller.js?v=21';
import { CityMap } from './world/city-map.js?v=30';
import {
  loadGameState,
  clearGameState,
  formatContinueLabel
} from './core/save-state.js?v=2';
import {
  loadStorySplashHeader,
  loadStoryPackage,
  markAssetLoaded,
  preloadImageAsset,
  preloadMissionAssets,
  preloadStoryAssets,
  refreshAllStoryAssets
} from './story/story-loader.js?v=28';

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function boot() {
  window.__gameBooted = true;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const hud = new HudController();
  const cutscene = new CutsceneController();
  const confirmDialog = new ConfirmDialogController();
  const assetsRefreshDialog = new AssetsRefreshDialogController();
  const pauseMenu = new PauseMenuController(confirmDialog, assetsRefreshDialog);
  const inventoryController = new InventoryController();
  const canvas = document.getElementById('game-canvas');
  const minimapCanvas = document.getElementById('minimap-canvas');
  const touchControls = document.getElementById('touch-controls');

  let storyPackage = null;
  let cityMap = null;
  let activeEngine = null;
  let savedState = null;
  const preloadedUrls = new Set();

  const refreshStartButtons = () => {
    const storyKey = storyPackage?.title || 'default';
    savedState = loadGameState(storyKey);
    hud.setStartButtonState({
      label: formatContinueLabel(savedState),
      hasSave: Boolean(savedState)
    });
  };

  try {
    hud.showLoading(15, 'Lendo abertura da história...');
    const splashHeader = await loadStorySplashHeader('./story');

    if (splashHeader.splashUrl) {
      hud.showLoading(60, 'Carregando tela inicial...');
      const splashRes = await preloadImageAsset(splashHeader.splashUrl);
      if (splashRes?.ok) {
        markAssetLoaded(splashHeader.splashUrl);
        preloadedUrls.add(splashHeader.splashUrl);
      }
    }

    hud.setStoryHeader({
      title: splashHeader.title,
      pageTitle: splashHeader.pageTitle,
      subtitle: splashHeader.subtitle,
      splashUrl: splashHeader.splashUrl,
      faviconUrl: splashHeader.faviconUrl
    });

    hud.showLoading(100, 'Tela inicial pronta!');
    await waitMs(40);
    hud.setStartLoadingProgress(4, 'Gerando cidade-base...', { ready: false });
    hud.showStartScreen();

    // Yield para garantir que o navegador pinte a splash screen antes de gerar o mapa
    await waitMs(16);
    cityMap = new CityMap();

    hud.setStartLoadingProgress(12, 'Carregando dados da história e missões...', { ready: false });
    storyPackage = await loadStoryPackage('./story', cityMap, {
      prefetchedManifest: splashHeader.manifest,
      prefetchedSplashUrl: splashHeader.splashUrl,
      prefetchedFaviconUrl: splashHeader.faviconUrl,
      onProgress: ({ ratio, message }) => {
        hud.setStartLoadingProgress(12 + ratio * 53, message, { ready: false });
      }
    });

    hud.setStoryHeader({
      title: storyPackage.title,
      pageTitle: storyPackage.pageTitle,
      subtitle: storyPackage.subtitle,
      splashUrl: storyPackage.splashUrl,
      faviconUrl: storyPackage.faviconUrl
    });

    refreshStartButtons();
    const targetMissionIndex = savedState
      ? Math.max(0, Math.min(savedState.currentMissionIndex || 0, Math.max(0, (storyPackage.missions?.length || 1) - 1)))
      : 0;
    const missionLabel = `Missão ${targetMissionIndex + 1}`;

    hud.setStartLoadingProgress(65, `Pré-carregando imagens da ${missionLabel} e itens extras...`, { ready: false });
    await preloadMissionAssets(storyPackage, targetMissionIndex, {
      includeSplash: false,
      includeExtras: true,
      preloadedUrls,
      onProgress: ({ loaded, total, ratio, url }) => {
        const assetName = url ? url.split('/').pop() : '';
        const label = total > 0 && assetName
          ? `${missionLabel} (${loaded}/${total}): ${assetName}`
          : `Recursos da ${missionLabel} prontos.`;
        hud.setStartLoadingProgress(65 + ratio * 35, label, { ready: false });
      }
    });

    hud.setStartLoadingProgress(100, `Recursos da ${missionLabel} carregados!`, { ready: true });
  } catch (error) {
    console.error('[StoryLoader] Erro ao carregar história:', error);
    hud.showError(error?.message || 'Erro ao carregar o pacote de história.');
    return;
  }

  let idlePreloadTimer = null;
  let backgroundPreloadPromise = null;
  let backgroundPreloadDone = false;
  let backgroundPreloadPercent = 0;

  const startBackgroundStoryPreload = () => {
    if (backgroundPreloadPromise || backgroundPreloadDone || !storyPackage) return;
    backgroundPreloadPercent = 0;
    if (hud.isStartScreenOpen()) {
      hud.setStartLoadingProgress(0, 'Carregando demais recursos da história...', { ready: true });
    } else {
      hud.setBackgroundLoadingProgress(0);
    }

    backgroundPreloadPromise = preloadStoryAssets(storyPackage, {
      preloadedUrls,
      onProgress: ({ loaded, total, ratio, url }) => {
        backgroundPreloadPercent = Math.round(ratio * 100);
        const assetName = url ? url.split('/').pop() : '';
        if (hud.isStartScreenOpen()) {
          const text = total > 0 && assetName
            ? `História (${loaded}/${total}): ${assetName}`
            : 'Todos os recursos da história carregados!';
          hud.setStartLoadingProgress(backgroundPreloadPercent, text, { ready: true });
        } else {
          hud.setBackgroundLoadingProgress(backgroundPreloadPercent);
        }
      },
    }).then(() => {
      backgroundPreloadDone = true;
      backgroundPreloadPromise = null;
      hud.hideBackgroundLoadingProgress();
      if (hud.isStartScreenOpen()) {
        hud.setStartLoadingProgress(100, 'Todos os recursos da história carregados!', { ready: true });
      }
    }).catch(() => {
      backgroundPreloadPromise = null;
      hud.hideBackgroundLoadingProgress();
    });
  };

  const scheduleIdleStoryPreload = () => {
    if (idlePreloadTimer || backgroundPreloadPromise || backgroundPreloadDone) return;
    idlePreloadTimer = setTimeout(() => {
      idlePreloadTimer = null;
      if (hud.isStartScreenOpen() && !activeEngine) {
        startBackgroundStoryPreload();
      }
    }, 10000);
  };
  scheduleIdleStoryPreload();

  const launchGame = ({ useSaved = true } = {}) => {
    try {
      if (idlePreloadTimer) {
        clearTimeout(idlePreloadTimer);
        idlePreloadTimer = null;
      }
      if (activeEngine) {
        activeEngine.stop();
      }
      if (!useSaved) {
        clearGameState();
        savedState = null;
      } else {
        savedState = loadGameState(storyPackage?.title || 'default');
      }
      activeEngine = new Engine(canvas, minimapCanvas, touchControls, hud, {
        cityMap,
        storyPackage,
        cutscene,
        pauseMenu,
        inventoryController,
        preloadedUrls,
        onNewGame: () => requestNewGame(() => pauseMenu.close()),
        onRefreshAssets: () => handleRefreshAssets(),
        onResetGame: () => requestResetGame(() => pauseMenu.close()),
        onExitToTitle: () => {
          activeEngine?.stop();
          activeEngine = null;
          hud.hideBackgroundLoadingProgress();
          refreshStartButtons();
          hud.showStartScreen();
          scheduleIdleStoryPreload();
        }
      });
      activeEngine.initWorld();
      activeEngine.start();
      if (backgroundPreloadPromise && !backgroundPreloadDone) {
        hud.setBackgroundLoadingProgress(backgroundPreloadPercent);
      } else {
        hud.hideBackgroundLoadingProgress();
      }
      if (useSaved && savedState) {
        activeEngine.restoreSavedSession(savedState);
      } else {
        activeEngine.startMission(0);
      }
    } catch (error) {
      console.error('[Engine] Erro fatal ao iniciar:', error);
      hud.showError(error?.message || 'Erro inesperado ao inicializar o motor do jogo.');
    }
  };

  const handleRefreshAssets = async () => {
    const signal = assetsRefreshDialog.open();
    try {
      const result = await refreshAllStoryAssets({
        basePath: './story',
        cityMap,
        preloadedUrls,
        signal,
        onProgress: ({ percent, text }) => {
          assetsRefreshDialog.setProgress(percent, text);
        },
      });
      if (signal.aborted) return;
      storyPackage = result.storyPackage;
      hud.setStoryHeader({
        title: storyPackage.title,
        pageTitle: storyPackage.pageTitle,
        subtitle: storyPackage.subtitle,
        splashUrl: storyPackage.splashUrl,
        faviconUrl: storyPackage.faviconUrl,
      });
      activeEngine?.applyRefreshedStoryPackage(storyPackage);
      const failNote = result.failed?.length
        ? ` (${result.failed.length} arquivo(s) não encontrado(s))`
        : '';
      assetsRefreshDialog.finish(
        `Atualização concluída! ${result.refreshedCount} imagem(ns) e dados salvos no navegador${failNote}.`,
      );
    } catch (error) {
      if (error?.name === 'AbortError' || signal.aborted) {
        return;
      }
      console.error('[StoryLoader] Erro ao recarregar assets:', error);
      assetsRefreshDialog.fail(error?.message || 'Erro ao recarregar assets.');
    }
  };

  const requestNewGame = (onConfirmed = null) => {
    confirmDialog.open({
      title: 'INICIAR NOVO JOGO?',
      message: 'Ao iniciar um novo jogo, todo o progresso atual será perdido. Deseja continuar?',
      cancelLabel: 'Cancelar',
      confirmLabel: 'Iniciar Novo Jogo',
      onConfirm: () => {
        onConfirmed?.();
        launchGame({ useSaved: false });
      }
    });
  };

  const resetAllSessionData = async () => {
    if (idlePreloadTimer) {
      clearTimeout(idlePreloadTimer);
      idlePreloadTimer = null;
    }
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    preloadedUrls.clear();
    try {
      window.localStorage?.clear();
    } catch {
      // ignora erro de localStorage
    }
    try {
      window.sessionStorage?.clear();
    } catch {
      // ignora erro de sessionStorage
    }
    if ('caches' in window) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      } catch {
        // ignora erro de Cache Storage
      }
    }
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      } catch {
        // ignora erro ao desregistrar Service Worker
      }
    }
    if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
      try {
        const dbs = await window.indexedDB.databases();
        await Promise.all(
          (dbs || []).map((db) => {
            if (!db?.name) return Promise.resolve();
            return new Promise((resolve) => {
              const req = window.indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            });
          })
        );
      } catch {
        // ignora erro de IndexedDB
      }
    }
    const baseHref = window.location.href.split('?')[0].split('#')[0];
    window.location.replace(`${baseHref}?fresh=${Date.now()}`);
  };

  const requestResetGame = (onConfirmed = null) => {
    confirmDialog.open({
      title: 'RESETAR TODO O JOGO?',
      message: 'Isso apagará progresso, inventário, cache de assets e dados locais, reiniciando como no primeiro acesso. Deseja continuar?',
      cancelLabel: 'Cancelar',
      confirmLabel: 'Resetar Tudo',
      onConfirm: () => {
        onConfirmed?.();
        resetAllSessionData();
      }
    });
  };

  hud.onStartClick(() => launchGame({ useSaved: true }));
  hud.onNewGameClick(() => requestNewGame());

  window.addEventListener('keydown', (e) => {
    if (!hud.isStartScreenOpen() || confirmDialog.isOpen) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') {
      e.preventDefault();
      hud.moveStartSelection(-1);
    } else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') {
      e.preventDefault();
      hud.moveStartSelection(1);
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      hud.triggerStart();
    }
  });

  let prevGpAction = false;
  let prevGpSecondary = false;
  let prevGpPrev = false;
  let prevGpNext = false;
  const pollStartGamepad = () => {
    if ((hud.isStartScreenOpen() || confirmDialog.isOpen) && !activeEngine && navigator.getGamepads) {
      const gps = navigator.getGamepads();
      let gpAction = false;
      let gpSecondary = false;
      let gpPrev = false;
      let gpNext = false;
      for (const gp of gps) {
        if (!gp?.connected) continue;
        if (gp.buttons[0]?.pressed) gpAction = true;
        if (gp.buttons[1]?.pressed) gpSecondary = true;
        const ax0 = gp.axes[0] ?? 0;
        const ax1 = gp.axes[1] ?? 0;
        if (gp.buttons[14]?.pressed || gp.buttons[12]?.pressed || ax0 < -0.5 || ax1 < -0.5) gpPrev = true;
        if (gp.buttons[15]?.pressed || gp.buttons[13]?.pressed || ax0 > 0.5 || ax1 > 0.5) gpNext = true;
      }
      if (confirmDialog.isOpen) {
        confirmDialog.updateInput({
          moveX: gpPrev ? -1 : gpNext ? 1 : 0,
          moveY: 0,
          actionJustPressed: gpAction && !prevGpAction,
          secondaryJustPressed: gpSecondary && !prevGpSecondary,
        });
      } else {
        if (gpPrev && !prevGpPrev) hud.moveStartSelection(-1);
        if (gpNext && !prevGpNext) hud.moveStartSelection(1);
        if (gpAction && !prevGpAction) hud.triggerStart();
      }
      prevGpAction = gpAction;
      prevGpSecondary = gpSecondary;
      prevGpPrev = gpPrev;
      prevGpNext = gpNext;
    } else {
      prevGpAction = true;
      prevGpSecondary = true;
      prevGpPrev = true;
      prevGpNext = true;
    }
    requestAnimationFrame(pollStartGamepad);
  };
  requestAnimationFrame(pollStartGamepad);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
