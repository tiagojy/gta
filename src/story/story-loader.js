import {
  parseStoryManifest,
  parseCharacterMarkdown,
  parseItemMarkdown,
  parseMissionMarkdown,
  parseEncounterMarkdown,
  parseMapMarkdown,
  replaceLocationCodesWithNames,
  validateAssetPath,
  StoryParseError,
} from './story-parser.js?v=18';

async function fetchText(url, label, options = {}) {
  const { forceReload = false, signal = null } = options;
  let response;
  try {
    response = await fetch(url, {
      cache: forceReload ? 'reload' : 'no-cache',
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(`Falha de rede ao carregar "${label}" (${url}): ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(`Arquivo não encontrado ou inacessível: "${label}" (${url}, status ${response.status}).`);
  }
  return response.text();
}

async function checkAssetExists(url, options = {}) {
  if (!url) return false;
  const { forceReload = false, signal = null } = options;
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      cache: forceReload ? 'reload' : 'default',
      ...(signal ? { signal } : {}),
    });
    return response.ok;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return false;
  }
}

export function getCharacterSidePngCandidates(basePath, charId, view) {
  const cleanBase = String(basePath || '').replace(/\/+$/, '');
  const candidates = [
    `${cleanBase}/characters/${charId}-${view}.png`,
    `${cleanBase}/characters/${charId}/${charId}-${view}.png`,
    `${cleanBase}/characters/${charId}.png`,
    `${cleanBase}/characters/${charId}/${charId}.png`,
  ];
  if (view === 'left') {
    candidates.push(
      `${cleanBase}/characters/${charId}-right.png`,
      `${cleanBase}/characters/${charId}/${charId}-right.png`,
    );
  }
  return candidates;
}

export function getSplashPngCandidates(basePath, manifestSplash = '') {
  const cleanBase = String(basePath || '').replace(/\/+$/, '');
  const candidates = [
    `${cleanBase}/splash/splash-start.png`,
    `${cleanBase}/splash.png`,
    `${cleanBase}/assets/splash.png`,
  ];
  if (manifestSplash) {
    const pngVariant = manifestSplash.replace(/\.[^./]+$/, '.png');
    const fullVariant = `${cleanBase}/${pngVariant}`;
    if (!candidates.includes(fullVariant)) {
      candidates.push(fullVariant);
    }
  }
  return candidates;
}

export function getCutsceneBackgroundCandidates(basePath, bgText = '', fallbackCode = '') {
  const cleanBase = String(basePath || '').replace(/\/+$/, '');
  const candidates = [];
  const rawBg = String(bgText || '').trim();

  if (/\.(jpe?g|png|webp)$/i.test(rawBg)) {
    const safeRel = validateAssetPath(rawBg, 'cutscene.bg');
    candidates.push(`${cleanBase}/${safeRel}`);
  }

  const codeMatch = rawBg.match(/\b((?:RUA|CASA|COM|PRACA)-\d+)\b/i);
  const code = (codeMatch ? codeMatch[1] : String(fallbackCode || '')).trim().toUpperCase();
  if (code) {
    const typePrefix = code.split('-')[0].toLowerCase();
    for (const rel of [
      `${cleanBase}/map/${code}.png`,
      `${cleanBase}/map/${code}.jpg`,
      `${cleanBase}/map/${code.toLowerCase()}.png`,
      `${cleanBase}/map/${code.toLowerCase()}.jpg`,
      `${cleanBase}/map/${typePrefix}.png`,
      `${cleanBase}/map/${typePrefix}.jpg`,
    ]) {
      if (!candidates.includes(rel)) {
        candidates.push(rel);
      }
    }
  }

  return candidates;
}

export async function resolveFirstExistingAsset(candidates, existsFn = checkAssetExists) {
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const results = await Promise.all(candidates.map((url) => existsFn(url)));
  const idx = results.findIndex(Boolean);
  return idx >= 0 ? candidates[idx] : '';
}

export function extractCutsceneLocationType(bgText = '', fallbackCode = '') {
  const rawBg = String(bgText || '').trim();
  const codeMatch = rawBg.match(/\b((?:RUA|CASA|COM|PRACA)-\d+)\b/i);
  const code = (codeMatch ? codeMatch[1] : String(fallbackCode || '')).trim().toUpperCase();
  if (!code) return '';
  return code.split('-')[0].toLowerCase();
}

export async function discoverTypeBackgroundPool(basePath, typePrefix, existsFn = checkAssetExists, maxProbe = 50) {
  const cleanBase = String(basePath || '').replace(/\/+$/, '');
  const prefix = String(typePrefix || '').trim().toLowerCase();
  if (!prefix) return [];

  const pool = [];
  const batchSize = 4;
  for (let start = 1; start <= maxProbe; start += batchSize) {
    const end = Math.min(maxProbe, start + batchSize - 1);
    const nums = [];
    for (let n = start; n <= end; n += 1) nums.push(n);
    const checks = await Promise.all(
      nums.map(async (n) => {
        const pngUrl = `${cleanBase}/map/${prefix}-${n}.png`;
        const jpgUrl = `${cleanBase}/map/${prefix}-${n}.jpg`;
        const [hasPng, hasJpg] = await Promise.all([existsFn(pngUrl), existsFn(jpgUrl)]);
        return hasPng ? pngUrl : hasJpg ? jpgUrl : '';
      }),
    );
    let stopped = false;
    for (const url of checks) {
      if (!url) {
        stopped = true;
        break;
      }
      pool.push(url);
    }
    if (stopped) break;
  }

  if (pool.length === 0) {
    const fallbackUrl = await resolveFirstExistingAsset(
      [`${cleanBase}/map/${prefix}.png`, `${cleanBase}/map/${prefix}.jpg`],
      existsFn,
    );
    if (fallbackUrl) {
      pool.push(fallbackUrl);
    }
  }

  return pool;
}

export const MAX_NPC_LINE_LENGTH = 60;

export function parseNpcLinesMarkdown(rawText = '') {
  if (!rawText || typeof rawText !== 'string') return [];
  const seen = new Set();
  const lines = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('<!--') || trimmed.startsWith('---')) continue;
    const cleaned = trimmed.replace(/^[-*]\s+/, '').trim();
    if (!cleaned || cleaned.length > MAX_NPC_LINE_LENGTH || seen.has(cleaned)) continue;
    seen.add(cleaned);
    lines.push(cleaned);
  }
  return lines;
}

export function pickCutsceneBackground(pool = [], recentList = [], rng = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) {
    return { url: '', nextRecent: [] };
  }
  if (pool.length === 1) {
    return { url: pool[0], nextRecent: [pool[0]] };
  }

  const recentSet = new Set(recentList);
  let candidates = pool.filter((url) => !recentSet.has(url));
  let baseRecent = [...recentList];

  if (candidates.length === 0) {
    const lastShown = recentList[recentList.length - 1];
    candidates = pool.filter((url) => url !== lastShown);
    baseRecent = lastShown ? [lastShown] : [];
    if (candidates.length === 0) {
      candidates = [...pool];
    }
  }

  const idx = Math.min(candidates.length - 1, Math.max(0, Math.floor(rng() * candidates.length)));
  const chosen = candidates[idx];
  return {
    url: chosen,
    nextRecent: [...baseRecent, chosen],
  };
}

async function resolveSplashAssetUrl(cleanBase, manifest, existsFn) {
  let url = await resolveFirstExistingAsset(
    getSplashPngCandidates(cleanBase, manifest.splash),
    existsFn,
  );
  if (!url && manifest.splash) {
    const candidateSplash = `${cleanBase}/${manifest.splash}`;
    if (await existsFn(candidateSplash)) {
      url = candidateSplash;
    } else {
      console.warn(`[StoryLoader] Imagem de abertura ausente: ${candidateSplash}. Usando padrão.`);
    }
  }
  return url;
}

export async function resolveStoryFaviconUrl(basePath = './story', existsFn = checkAssetExists) {
  const cleanBase = basePath.replace(/\/+$/, '');
  const candidates = [
    `${cleanBase}/favicon.svg`,
    `${cleanBase}/favicon.png`,
    `${cleanBase}/favicon.ico`,
  ];
  const found = await resolveFirstExistingAsset(candidates, existsFn);
  return found || './icon.svg';
}

export async function loadStorySplashHeader(basePath = './story') {
  const cleanBase = basePath.replace(/\/+$/, '');
  const manifestUrl = `${cleanBase}/story.md`;
  const manifestRaw = await fetchText(manifestUrl, 'story.md');
  const manifest = parseStoryManifest(manifestRaw, 'story.md');
  const [splashUrl, faviconUrl] = await Promise.all([
    resolveSplashAssetUrl(cleanBase, manifest, checkAssetExists),
    resolveStoryFaviconUrl(cleanBase, checkAssetExists),
  ]);
  return {
    title: manifest.title,
    pageTitle: manifest.pageTitle || manifest.title,
    subtitle: manifest.subtitle,
    splashUrl,
    faviconUrl,
    manifest,
  };
}

export async function loadStoryPackage(basePath = './story', cityMap = null, options = {}) {
  const {
    onProgress,
    prefetchedManifest = null,
    prefetchedSplashUrl = undefined,
    prefetchedFaviconUrl = undefined,
    forceReload = false,
    signal = null,
  } = options;
  const reportProgress = (ratio, message) => {
    if (typeof onProgress === 'function') {
      onProgress({ ratio: Math.max(0, Math.min(1, ratio)), message });
    }
  };

  const cleanBase = basePath.replace(/\/+$/, '');
  const manifestUrl = `${cleanBase}/story.md`;
  const withBust = (url) => url;
  const readStoryText = (url, label) => fetchText(url, label, { forceReload, signal });
  const existsCache = new Map();
  const cachedExists = (url) => {
    if (!url) return Promise.resolve(false);
    if (!existsCache.has(url)) {
      existsCache.set(url, checkAssetExists(url, { forceReload, signal }));
    }
    return existsCache.get(url);
  };

  let manifest = prefetchedManifest;
  if (!manifest) {
    reportProgress(0.05, 'Lendo manifesto da história...');
    const manifestRaw = await readStoryText(manifestUrl, 'story.md');
    manifest = parseStoryManifest(manifestRaw, 'story.md');
  } else {
    reportProgress(0.05, 'Manifesto carregado. Lendo mapa...');
  }

  let locationNames = new Map();
  const mapUrl = `${cleanBase}/map/map.md`;
  const mapPromise = (async () => {
    if (await cachedExists(mapUrl)) {
      const mapRaw = await readStoryText(mapUrl, 'map/map.md');
      locationNames = parseMapMarkdown(mapRaw, 'map/map.md');
    }
  })();

  const splashPromise = prefetchedSplashUrl !== undefined
    ? Promise.resolve(prefetchedSplashUrl)
    : resolveSplashAssetUrl(cleanBase, manifest, cachedExists);

  const totalChars = Math.max(1, manifest.characters.length);
  let loadedChars = 0;
  const characters = new Map();
  const charsPromise = Promise.all(
    manifest.characters.map(async (charId) => {
      const charFile = `characters/${charId}.md`;
      const raw = await readStoryText(`${cleanBase}/${charFile}`, charFile);
      const character = parseCharacterMarkdown(raw, charFile);

      const resolvedSprites = {};
      await Promise.all(
        Object.entries(character.sprites).map(async ([view, relPath]) => {
          if (view === 'left' || view === 'right') {
            const pngOverride = await resolveFirstExistingAsset(
              getCharacterSidePngCandidates(cleanBase, charId, view),
              cachedExists,
            );
            if (pngOverride) {
              resolvedSprites[view] = withBust(pngOverride);
              return;
            }
          }
          if (!relPath) {
            resolvedSprites[view] = '';
            return;
          }
          const fullUrl = `${cleanBase}/${relPath}`;
          if (await cachedExists(fullUrl)) {
            resolvedSprites[view] = withBust(fullUrl);
          } else {
            console.warn(`[StoryLoader] Sprite "${view}" de "${charId}" ausente (${fullUrl}). Aplicando fallback.`);
            resolvedSprites[view] = '';
          }
        }),
      );

      characters.set(character.id, {
        ...character,
        sprites: resolvedSprites,
      });
      loadedChars += 1;
      reportProgress(0.2 + (loadedChars / totalChars) * 0.25, `Carregando personagens (${loadedChars}/${totalChars})...`);
    }),
  );

  const items = new Map();
  const itemIds = [...new Set([...(manifest.items || []), ...(manifest.collectibles || [])])];
  const totalItems = Math.max(1, itemIds.length);
  let loadedItems = 0;
  const itemsPromise = Promise.all(
    itemIds.map(async (itemId) => {
      const itemFile = `items/${itemId}.md`;
      const raw = await readStoryText(`${cleanBase}/${itemFile}`, itemFile);
      const item = parseItemMarkdown(raw, itemFile);
      let worldPoint = null;
      if (item.location && cityMap?.resolveItemLocation) {
        worldPoint = cityMap.resolveItemLocation(item.location);
      }
      let imageUrl = '';
      if (item.image) {
        const fullUrl = `${cleanBase}/${item.image}`;
        if (await cachedExists(fullUrl)) {
          imageUrl = withBust(fullUrl);
        } else {
          console.warn(`[StoryLoader] Imagem do item "${itemId}" ausente (${fullUrl}).`);
        }
      }
      items.set(item.id, {
        ...item,
        imageUrl,
        worldPoint,
      });
      loadedItems += 1;
      reportProgress(0.45 + (loadedItems / totalItems) * 0.15, `Carregando itens (${loadedItems}/${totalItems})...`);
    }),
  );

  const typePools = new Map();
  const poolsPromise = Promise.all(
    ['casa', 'com', 'praca', 'rua'].map(async (typePrefix) => {
      const discovered = await discoverTypeBackgroundPool(cleanBase, typePrefix, cachedExists);
      typePools.set(typePrefix, discovered.map((url) => withBust(url)));
    }),
  );

  const faviconPromise = !forceReload && prefetchedFaviconUrl !== undefined
    ? Promise.resolve(prefetchedFaviconUrl)
    : resolveStoryFaviconUrl(cleanBase, cachedExists);

  const npcLinesPromise = (async () => {
    try {
      const raw = await readStoryText(`${cleanBase}/npc-lines.md`, 'npc-lines.md');
      return parseNpcLinesMarkdown(raw);
    } catch {
      return [];
    }
  })();

  const wrongItemLinesPromise = (async () => {
    try {
      const raw = await readStoryText(`${cleanBase}/wrong-item-lines.md`, 'wrong-item-lines.md');
      return parseNpcLinesMarkdown(raw);
    } catch {
      return [];
    }
  })();

  const [, splashUrl, faviconUrl, npcLines, wrongItemLines] = await Promise.all([
    mapPromise,
    splashPromise,
    faviconPromise,
    npcLinesPromise,
    wrongItemLinesPromise,
    charsPromise,
    itemsPromise,
    poolsPromise,
  ]);

  async function hydrateCutscene(cutscene, fallbackCode, sourceFile) {
    if (cutscene.leftChar && !characters.has(cutscene.leftChar)) {
      throw new StoryParseError(sourceFile, 0, `Personagem "${cutscene.leftChar}" não declarado em story.md.`);
    }
    if (cutscene.rightChar && !characters.has(cutscene.rightChar)) {
      throw new StoryParseError(sourceFile, 0, `Personagem "${cutscene.rightChar}" não declarado em story.md.`);
    }
    const bgType = extractCutsceneLocationType(cutscene.background, fallbackCode);
    const pool = typePools.get(bgType) || [];
    const explicitCandidates = getCutsceneBackgroundCandidates(cleanBase, cutscene.background, fallbackCode)
      .filter((url) => !/\/map\/(?:casa|com|praca|rua)\.(?:png|jpe?g)$/i.test(url));
    const explicitBg = withBust(await resolveFirstExistingAsset(explicitCandidates, cachedExists));

    cutscene.backgroundType = bgType;
    cutscene.backgroundPool = explicitBg ? [explicitBg] : pool;
    cutscene.backgroundImage = explicitBg || pool[0] || withBust(await resolveFirstExistingAsset(
      getCutsceneBackgroundCandidates(cleanBase, cutscene.background, fallbackCode),
      cachedExists,
    ));
    cutscene.background = replaceLocationCodesWithNames(cutscene.background, locationNames);
    for (const step of cutscene.steps) {
      step.text = replaceLocationCodesWithNames(step.text, locationNames);
      if (step.choices) {
        for (const choice of step.choices) {
          choice.label = replaceLocationCodesWithNames(choice.label, locationNames);
          choice.reason = replaceLocationCodesWithNames(choice.reason, locationNames);
        }
      }
    }
  }

  const totalMissions = Math.max(1, manifest.missions.length);
  let loadedMissions = 0;
  const missions = await Promise.all(
    manifest.missions.map(async (missionId) => {
      const missionFile = `missions/${missionId}.md`;
      const raw = await readStoryText(`${cleanBase}/${missionFile}`, missionFile);
      const mission = parseMissionMarkdown(raw, missionFile, cityMap);

      if (mission.giveItem && !items.has(mission.giveItem)) {
        throw new StoryParseError(missionFile, 2, `Item "${mission.giveItem}" (give_item) não declarado em story.md.`);
      }
      if (mission.requireItem && !items.has(mission.requireItem)) {
        throw new StoryParseError(missionFile, 2, `Item "${mission.requireItem}" (require_item) não declarado em story.md.`);
      }

      const cutsceneConfigs = [
        { cutscene: mission.introCutscene, fallbackCode: mission.startLocation },
        { cutscene: mission.outroCutscene, fallbackCode: mission.targetLocation },
      ];

      await Promise.all(
        cutsceneConfigs.map(({ cutscene, fallbackCode }) =>
          hydrateCutscene(cutscene, fallbackCode, missionFile),
        ),
      );

      mission.objective = replaceLocationCodesWithNames(mission.objective, locationNames);
      if (mission.pickupObjective) {
        mission.pickupObjective = replaceLocationCodesWithNames(mission.pickupObjective, locationNames);
      }
      if (mission.deliveryPrompt) {
        mission.deliveryPrompt = replaceLocationCodesWithNames(mission.deliveryPrompt, locationNames);
      }
      if (mission.wrongItemMessage) {
        mission.wrongItemMessage = replaceLocationCodesWithNames(mission.wrongItemMessage, locationNames);
      }
      loadedMissions += 1;
      reportProgress(
        0.6 + (loadedMissions / totalMissions) * 0.4,
        `Carregando missões (${loadedMissions}/${totalMissions})...`,
      );
      return mission;
    }),
  );

  const encounters = await Promise.all(
    (manifest.encounters || []).map(async (encounterId) => {
      const encounterFile = `missions/${encounterId}.md`;
      const raw = await readStoryText(`${cleanBase}/${encounterFile}`, encounterFile);
      const encounter = parseEncounterMarkdown(raw, encounterFile, cityMap);
      if (!characters.has(encounter.npc)) {
        throw new StoryParseError(
          encounterFile,
          2,
          `Personagem "${encounter.npc}" (npc) não declarado em story.md.`,
        );
      }
      await hydrateCutscene(encounter.cutscene, encounter.location, encounterFile);
      if (encounter.prompt) {
        encounter.prompt = replaceLocationCodesWithNames(encounter.prompt, locationNames);
      }
      if (encounter.roofLogo) {
        encounter.roofLogo = withBust(`${cleanBase}/${encounter.roofLogo}`);
      }
      return encounter;
    }),
  );

  console.info(
    `[StoryLoader] História "${manifest.title}" carregada (${characters.size} personagens, ${items.size} itens, ${missions.length} missões, ${encounters.length} encontros extras, ${locationNames.size} locais nomeados).`,
  );

  return {
    title: replaceLocationCodesWithNames(manifest.title, locationNames),
    pageTitle: replaceLocationCodesWithNames(manifest.pageTitle || manifest.title, locationNames),
    subtitle: replaceLocationCodesWithNames(manifest.subtitle, locationNames),
    splashUrl: withBust(splashUrl),
    faviconUrl: withBust(faviconUrl),
    npcLines,
    wrongItemLines,
    characters,
    items,
    missions,
    encounters,
    locationNames,
  };
}

export function collectStoryAssetUrls(storyPackage) {
  if (!storyPackage) return [];
  const urls = new Set();
  if (storyPackage.splashUrl) {
    urls.add(storyPackage.splashUrl);
  }
  if (storyPackage.faviconUrl && storyPackage.faviconUrl !== './icon.svg') {
    urls.add(storyPackage.faviconUrl);
  }
  if (storyPackage.characters instanceof Map) {
    for (const character of storyPackage.characters.values()) {
      for (const spriteUrl of Object.values(character?.sprites || {})) {
        if (spriteUrl) urls.add(spriteUrl);
      }
    }
  }
  if (storyPackage.items instanceof Map) {
    for (const item of storyPackage.items.values()) {
      if (item?.imageUrl) urls.add(item.imageUrl);
    }
  }
  for (const mission of storyPackage.missions || []) {
    for (const cs of [mission?.introCutscene, mission?.outroCutscene]) {
      if (!cs) continue;
      if (cs.backgroundImage) urls.add(cs.backgroundImage);
      if (Array.isArray(cs.backgroundPool)) {
        for (const bgUrl of cs.backgroundPool) {
          if (bgUrl) urls.add(bgUrl);
        }
      }
    }
  }
  for (const encounter of storyPackage.encounters || []) {
    if (encounter?.roofLogo) urls.add(encounter.roofLogo);
    const cs = encounter?.cutscene;
    if (!cs) continue;
    if (cs.backgroundImage) urls.add(cs.backgroundImage);
    if (Array.isArray(cs.backgroundPool)) {
      for (const bgUrl of cs.backgroundPool) {
        if (bgUrl) urls.add(bgUrl);
      }
    }
  }
  return [...urls];
}

export function collectExtraItemAssetUrls(storyPackage) {
  if (!storyPackage || !(storyPackage.items instanceof Map)) return [];
  const urls = new Set();
  for (const item of storyPackage.items.values()) {
    if (item?.category === 'extra' && item?.imageUrl) {
      urls.add(item.imageUrl);
    }
  }
  return [...urls];
}

export function collectMissionAssetUrls(storyPackage, missionIndex = 0, options = {}) {
  const { includeSplash = missionIndex === 0, essentialOnly = false, includeExtras = false } = options;
  if (!storyPackage) return [];
  const urls = new Set();

  if (includeSplash && storyPackage.splashUrl) {
    urls.add(storyPackage.splashUrl);
  }
  if (includeExtras) {
    for (const extraUrl of collectExtraItemAssetUrls(storyPackage)) {
      urls.add(extraUrl);
    }
  }

  const mission = storyPackage.missions?.[missionIndex];
  if (!mission) return [...urls];

  const cutscenes = essentialOnly
    ? [mission.introCutscene]
    : [mission.introCutscene, mission.outroCutscene];
  const charIds = new Set();
  for (const cs of cutscenes) {
    if (!cs) continue;
    if (essentialOnly) {
      const firstBg = cs.backgroundImage || (Array.isArray(cs.backgroundPool) ? cs.backgroundPool[0] : '');
      if (firstBg) urls.add(firstBg);
    } else {
      if (cs.backgroundImage) urls.add(cs.backgroundImage);
      if (Array.isArray(cs.backgroundPool)) {
        for (const bgUrl of cs.backgroundPool) {
          if (bgUrl) urls.add(bgUrl);
        }
      }
    }
    if (cs.leftChar) charIds.add(cs.leftChar);
    if (cs.rightChar) charIds.add(cs.rightChar);
  }

  if (storyPackage.characters instanceof Map) {
    for (const charId of charIds) {
      const character = storyPackage.characters.get(charId);
      for (const spriteUrl of Object.values(character?.sprites || {})) {
        if (spriteUrl) urls.add(spriteUrl);
      }
    }
  }

  if (storyPackage.items instanceof Map) {
    for (const itemId of [mission.giveItem, mission.requireItem]) {
      if (!itemId) continue;
      const item = storyPackage.items.get(itemId);
      if (item?.imageUrl) urls.add(item.imageUrl);
    }
  }

  return [...urls];
}

const loadedAssetRegistry = new Set();

export function markAssetLoaded(url) {
  if (url) loadedAssetRegistry.add(url);
}

export function isAssetLoaded(url) {
  return Boolean(url && loadedAssetRegistry.has(url));
}

export function getLoadedAssetUrls() {
  return [...loadedAssetRegistry];
}

export function clearLoadedAssets() {
  loadedAssetRegistry.clear();
}

export function getPendingMissionAssetUrls(storyPackage, missionIndex = 0, preloadedUrls = null, options = {}) {
  const urls = collectMissionAssetUrls(storyPackage, missionIndex, options);
  const { forceReload = false } = options;
  return urls.filter((url) => {
    if (!forceReload && isAssetLoaded(url)) return false;
    if (preloadedUrls instanceof Set && preloadedUrls.has(url)) return false;
    return true;
  });
}

export function preloadImageAsset(url, loadImageFn = null) {
  if (!url) return Promise.resolve({ url, ok: false });
  if (typeof loadImageFn === 'function') {
    return Promise.resolve(loadImageFn(url))
      .then((ok) => ({ url, ok: ok !== false }))
      .catch(() => ({ url, ok: false }));
  }
  if (typeof Image === 'undefined') {
    return Promise.resolve({ url, ok: true });
  }
  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => resolve({ url, ok });
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(() => finish(true)).catch(() => finish(true));
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function preloadUrlList(urls, options = {}) {
  const { onProgress, loadImageFn = null, preloadedUrls = null, forceReload = false } = options;
  const pending = urls.filter((url) => {
    if (!forceReload && isAssetLoaded(url)) {
      preloadedUrls?.add(url);
      return false;
    }
    if (preloadedUrls instanceof Set && preloadedUrls.has(url)) {
      return false;
    }
    return true;
  });
  const total = pending.length;
  if (total === 0) {
    if (typeof onProgress === 'function') {
      onProgress({ loaded: 0, total: 0, ratio: 1, url: '' });
    }
    return { total: 0, loaded: 0, failed: [] };
  }

  let loaded = 0;
  const failed = [];
  await Promise.all(
    pending.map(async (url) => {
      const result = await preloadImageAsset(url, loadImageFn);
      if (result.ok) {
        markAssetLoaded(url);
        preloadedUrls?.add(url);
      } else {
        failed.push(url);
        console.warn(`[StoryLoader] Falha ao pré-carregar imagem: ${url}`);
      }
      loaded += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          loaded,
          total,
          ratio: loaded / total,
          url,
        });
      }
    }),
  );

  return { total, loaded, failed };
}

export async function preloadStoryAssets(storyPackage, options = {}) {
  const urls = collectStoryAssetUrls(storyPackage);
  return preloadUrlList(urls, options);
}

export async function preloadMissionAssets(storyPackage, missionIndex = 0, options = {}) {
  const { includeSplash = missionIndex === 0, essentialOnly = false, includeExtras = false, ...rest } = options;
  const urls = collectMissionAssetUrls(storyPackage, missionIndex, { includeSplash, essentialOnly, includeExtras });
  return preloadUrlList(urls, rest);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
  }
}

export async function refreshAllStoryAssets({
  basePath = './story',
  cityMap = null,
  preloadedUrls = null,
  signal = null,
  assetsCacheName = 'gta-cv-assets-v4',
  shellCacheName = 'gta-cv-shell-v1',
  onProgress = null,
} = {}) {
  const report = (ratio, text) => {
    if (typeof onProgress === 'function') {
      onProgress({
        ratio: Math.max(0, Math.min(1, ratio)),
        percent: Math.round(Math.max(0, Math.min(1, ratio)) * 100),
        text,
      });
    }
  };

  throwIfAborted(signal);
  report(0.02, 'Recarregando manifesto, mapa, missões e itens...');

  const freshPackage = await loadStoryPackage(basePath, cityMap, {
    forceReload: true,
    signal,
    onProgress: ({ ratio, message }) => {
      report(0.02 + ratio * 0.33, message || 'Recarregando dados da história...');
    },
  });

  throwIfAborted(signal);

  const assetUrls = collectStoryAssetUrls(freshPackage);
  const assetsCache = typeof caches !== 'undefined' ? await caches.open(assetsCacheName) : null;
  const shellCache = typeof caches !== 'undefined' ? await caches.open(shellCacheName) : null;

  if (preloadedUrls instanceof Set) {
    preloadedUrls.clear();
  }
  clearLoadedAssets();

  const totalAssets = assetUrls.length;
  const failed = [];
  let refreshedCount = 0;

  for (let i = 0; i < totalAssets; i += 1) {
    throwIfAborted(signal);
    const url = assetUrls[i];
    const shortName = url.split('/').pop() || url;
    report(
      0.35 + (i / Math.max(1, totalAssets)) * 0.58,
      `Recarregando e salvando imagem (${i + 1}/${totalAssets}): ${shortName}`,
    );

    try {
      const response = await fetch(url, {
        cache: 'reload',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        failed.push(url);
      } else {
        if (assetsCache) {
          await assetsCache.put(url, response.clone()).catch(() => {});
        }
        const decoded = await preloadImageAsset(url);
        if (decoded.ok) {
          markAssetLoaded(url);
          preloadedUrls?.add(url);
          refreshedCount += 1;
        } else {
          failed.push(url);
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      failed.push(url);
    }

    report(
      0.35 + ((i + 1) / Math.max(1, totalAssets)) * 0.58,
      `Salvo (${i + 1}/${totalAssets}): ${shortName}`,
    );
  }

  throwIfAborted(signal);

  const shellUrls = ['./', './index.html', './styles/main.css', './manifest.json'];
  for (let i = 0; i < shellUrls.length; i += 1) {
    throwIfAborted(signal);
    const shellUrl = shellUrls[i];
    report(
      0.93 + (i / shellUrls.length) * 0.06,
      `Atualizando cache do aplicativo (${shellUrl.replace('./', '') || 'index.html'})...`,
    );
    try {
      const res = await fetch(shellUrl, {
        cache: 'reload',
        ...(signal ? { signal } : {}),
      });
      if (res.ok && shellCache) {
        await shellCache.put(shellUrl, res.clone()).catch(() => {});
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  report(1, `Concluído! ${refreshedCount} imagem(ns) e dados salvos no navegador.`);
  return {
    storyPackage: freshPackage,
    totalAssets,
    refreshedCount,
    failed,
  };
}
