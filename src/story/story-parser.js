export class StoryParseError extends Error {
  constructor(fileName, line, message) {
    const loc = line ? `${fileName}:${line}` : fileName;
    super(`[${loc}] ${message}`);
    this.name = 'StoryParseError';
    this.fileName = fileName;
    this.line = line || 0;
  }
}

export function validateAssetPath(rawPath, fileName, line = 1) {
  const value = String(rawPath || '').trim();
  if (!value) return '';
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('..') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) {
    throw new StoryParseError(
      fileName,
      line,
      `Caminho de recurso inválido "${value}". Use apenas caminhos relativos dentro da pasta da história.`,
    );
  }
  return value.replace(/^\.\//, '');
}

export function parseFrontmatter(rawText, fileName = 'arquivo.md') {
  const normalized = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== '---') {
    throw new StoryParseError(fileName, 1, 'Cabeçalho frontmatter "---" ausente na primeira linha.');
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new StoryParseError(fileName, 1, 'Fechamento "---" do frontmatter não encontrado.');
  }

  const meta = {};
  for (let i = 1; i < endIndex; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) {
      throw new StoryParseError(fileName, i + 1, `Linha inválida no frontmatter: "${trimmed}". Esperado "chave: valor".`);
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const val = trimmed.slice(colonIndex + 1).trim();
    meta[key] = val;
  }

  const body = lines.slice(endIndex + 1).join('\n').trim();
  return { meta, body, bodyStartLine: endIndex + 2 };
}

function parseListField(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseStoryManifest(rawText, fileName = 'story.md') {
  const { meta, body } = parseFrontmatter(rawText, fileName);

  if (!meta.title) {
    throw new StoryParseError(fileName, 2, 'Campo obrigatório "title" ausente em story.md.');
  }

  const characters = parseListField(meta.characters);
  if (characters.length === 0) {
    throw new StoryParseError(fileName, 2, 'Campo obrigatório "characters" deve listar ao menos um personagem.');
  }

  const missions = parseListField(meta.missions);
  if (missions.length === 0) {
    throw new StoryParseError(fileName, 2, 'Campo obrigatório "missions" deve listar ao menos uma missão.');
  }

  const items = parseListField(meta.items);
  const collectibles = parseListField(meta.collectibles);
  const encounters = parseListField(meta.encounters);

  return {
    title: meta.title,
    pageTitle: meta.page_title || '',
    subtitle: meta.subtitle || '',
    splash: validateAssetPath(meta.splash || '', fileName, 2),
    characters,
    missions,
    items,
    collectibles,
    encounters,
    description: body,
  };
}

export function parseItemMarkdown(rawText, fileName = 'item.md') {
  const { meta, body } = parseFrontmatter(rawText, fileName);

  if (!meta.id || !meta.name) {
    throw new StoryParseError(fileName, 2, 'Item deve definir "id" e "name" no frontmatter.');
  }

  const rawCategory = String(meta.category || 'missao').trim().toLowerCase();
  if (rawCategory !== 'missao' && rawCategory !== 'extra') {
    throw new StoryParseError(fileName, 2, `Categoria inválida para item "${meta.id}": "${meta.category}". Use "missao" ou "extra".`);
  }
  const rawRarity = String(meta.rarity || '').trim().toLowerCase();
  if (rawRarity && rawRarity !== 'normal' && rawRarity !== 'especial' && rawRarity !== 'lendario') {
    throw new StoryParseError(fileName, 2, `Raridade inválida para item "${meta.id}": "${meta.rarity}". Use "normal", "especial" ou "lendario".`);
  }

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description || body || '',
    image: validateAssetPath(meta.image || '', fileName, 2),
    location: String(meta.location || '').trim(),
    category: rawCategory,
    rarity: rawRarity || (rawCategory === 'extra' ? 'normal' : ''),
  };
}

export function parseCharacterMarkdown(rawText, fileName = 'character.md') {
  const { meta } = parseFrontmatter(rawText, fileName);

  if (!meta.id || !meta.name) {
    throw new StoryParseError(fileName, 2, 'Personagem deve definir "id" e "name" no frontmatter.');
  }

  return {
    id: meta.id,
    name: meta.name,
    profile: meta.profile || '',
    traits: meta.traits || '',
    sprites: {
      top: validateAssetPath(meta.sprite_top || '', fileName, 2),
      front: validateAssetPath(meta.sprite_front || '', fileName, 2),
      left: validateAssetPath(meta.sprite_left || '', fileName, 2),
      right: validateAssetPath(meta.sprite_right || '', fileName, 2),
    },
  };
}

function parseCutsceneBlock(blockLines, startLine, fileName) {
  const cutscene = {
    leftChar: '',
    rightChar: '',
    background: '',
    steps: [],
  };

  let pendingChoices = null;

  for (let i = 0; i < blockLines.length; i += 1) {
    const lineNum = startLine + i;
    const trimmed = blockLines[i].trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ENTREGAR:')) {
      const itemId = trimmed.slice('- ENTREGAR:'.length).trim();
      pendingChoices = null;
      cutscene.steps.push({
        type: 'deliver',
        itemId,
        speaker: '',
        text: '',
      });
      continue;
    }

    if (trimmed.startsWith('- LINK:')) {
      const linkBody = trimmed.slice('- LINK:'.length).trim();
      const arrowIdx = linkBody.indexOf('->');
      const label = arrowIdx === -1
        ? 'Visualizar o link'
        : (linkBody.slice(0, arrowIdx).trim() || 'Visualizar o link');
      const rawUrl = arrowIdx === -1 ? linkBody : linkBody.slice(arrowIdx + 2).trim();

      if (!rawUrl) {
        throw new StoryParseError(
          fileName,
          lineNum,
          'Link vazio em "- LINK:". Use "- LINK: Texto -> https://..." ou "- LINK: https://...".',
        );
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        throw new StoryParseError(
          fileName,
          lineNum,
          `URL inválida "${rawUrl}" em "- LINK:". Use uma URL completa com http:// ou https://.`,
        );
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new StoryParseError(
          fileName,
          lineNum,
          `Protocolo não permitido "${parsedUrl.protocol}" em "- LINK:". Use apenas http:// ou https://.`,
        );
      }

      const lastStep = cutscene.steps[cutscene.steps.length - 1];
      if (!lastStep || lastStep.type === 'deliver') {
        throw new StoryParseError(
          fileName,
          lineNum,
          'A diretiva "- LINK:" deve vir logo após uma fala de personagem.',
        );
      }
      if (lastStep.link) {
        throw new StoryParseError(
          fileName,
          lineNum,
          'Cada fala pode ter apenas uma diretiva "- LINK:".',
        );
      }

      pendingChoices = null;
      lastStep.link = {
        label,
        url: parsedUrl.href,
      };
      continue;
    }

    if (trimmed.startsWith('- OPCAO:')) {
      const optionBody = trimmed.slice('- OPCAO:'.length).trim();
      const arrowIdx = optionBody.indexOf('->');
      if (arrowIdx === -1) {
        throw new StoryParseError(
          fileName,
          lineNum,
          'Opção malformada. Use "- OPCAO: Texto -> COMPLETE" ou "-> GAMEOVER: motivo".',
        );
      }

      const label = optionBody.slice(0, arrowIdx).trim();
      const targetRaw = optionBody.slice(arrowIdx + 2).trim();
      let outcome = 'complete';
      let reason = '';

      if (targetRaw.toUpperCase().startsWith('GAMEOVER')) {
        outcome = 'gameover';
        const colonIdx = targetRaw.indexOf(':');
        reason = colonIdx !== -1 ? targetRaw.slice(colonIdx + 1).trim() : 'Você fez a escolha errada.';
      } else if (targetRaw.toUpperCase() === 'NEXT') {
        outcome = 'next';
      } else if (targetRaw.toUpperCase() === 'COMPLETE') {
        outcome = 'complete';
      } else {
        throw new StoryParseError(
          fileName,
          lineNum,
          `Destino de opção desconhecido "${targetRaw}". Use COMPLETE, NEXT ou GAMEOVER: motivo.`,
        );
      }

      if (!pendingChoices) {
        if (cutscene.steps.length === 0) {
          cutscene.steps.push({ speaker: '', text: 'Escolha uma ação:', choices: [] });
        }
        const lastStep = cutscene.steps[cutscene.steps.length - 1];
        lastStep.choices = lastStep.choices || [];
        pendingChoices = lastStep.choices;
      }

      pendingChoices.push({ label, outcome, reason });
      continue;
    }

    pendingChoices = null;

    if (trimmed.startsWith('- ')) {
      const speech = trimmed.slice(2).trim();
      const colonIdx = speech.indexOf(':');
      if (colonIdx <= 0) {
        throw new StoryParseError(fileName, lineNum, `Fala malformada: "${trimmed}". Use "- Personagem: Fala".`);
      }
      const speaker = speech.slice(0, colonIdx).trim();
      const text = speech.slice(colonIdx + 1).trim();
      cutscene.steps.push({ speaker, text });
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();
      const normalizeChar = (val) => (/^(?:none|nenhum|-)$/i.test(val) ? '' : val);
      if (key === 'left') cutscene.leftChar = normalizeChar(value);
      else if (key === 'right') cutscene.rightChar = normalizeChar(value);
      else if (key === 'bg') cutscene.background = value;
    }
  }

  return cutscene;
}

function splitMarkdownSections(body, bodyStartLine, allowedNames) {
  const lines = body ? body.split('\n') : [];
  const sections = {};
  const sectionStarts = {};
  for (const name of allowedNames) {
    sections[name] = [];
    sectionStarts[name] = bodyStartLine;
  }
  let activeSection = null;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ')) {
      const name = trimmed.slice(3).trim().toUpperCase();
      if (allowedNames.includes(name)) {
        activeSection = name;
        sectionStarts[name] = bodyStartLine + i + 1;
      } else {
        activeSection = null;
      }
      continue;
    }
    if (activeSection) {
      sections[activeSection].push(lines[i]);
    }
  }

  return { sections, sectionStarts };
}

export function parseMissionMarkdown(rawText, fileName = 'mission.md', cityMap = null) {
  const { meta, body, bodyStartLine } = parseFrontmatter(rawText, fileName);

  if (!meta.id || !meta.title || !meta.start || !meta.target) {
    throw new StoryParseError(
      fileName,
      2,
      'Missão deve definir "id", "title", "start" e "target" no frontmatter.',
    );
  }

  if (cityMap) {
    try {
      cityMap.resolveLocationCode(meta.start);
    } catch (err) {
      throw new StoryParseError(fileName, 2, `Local de início inválido ("start: ${meta.start}"): ${err.message}`);
    }
    try {
      cityMap.resolveLocationCode(meta.target);
    } catch (err) {
      throw new StoryParseError(fileName, 2, `Local de destino inválido ("target: ${meta.target}"): ${err.message}`);
    }
    if (meta.pickup) {
      try {
        cityMap.resolveLocationCode(meta.pickup);
      } catch (err) {
        throw new StoryParseError(fileName, 2, `Local de coleta inválido ("pickup: ${meta.pickup}"): ${err.message}`);
      }
    }
  }

  const { sections, sectionStarts } = splitMarkdownSections(body, bodyStartLine, [
    'CUTSCENE_INICIO',
    'CUTSCENE_FIM',
  ]);

  return {
    id: meta.id,
    title: meta.title,
    startLocation: meta.start,
    pickupLocation: String(meta.pickup || '').trim(),
    pickupObjective: String(meta.pickup_objective || '').trim(),
    targetLocation: meta.target,
    objective: meta.objective || `Vá até ${meta.target}`,
    reward: (meta.reward !== undefined && String(meta.reward).trim() !== '' && Number.isFinite(Number(meta.reward)) && Number(meta.reward) >= 0)
      ? Math.floor(Number(meta.reward))
      : null,
    giveItem: String(meta.give_item || '').trim(),
    requireItem: String(meta.require_item || '').trim(),
    deliveryPrompt: String(meta.delivery_prompt || '').trim(),
    wrongItemMessage: String(meta.wrong_item_message || '').trim(),
    introCutscene: parseCutsceneBlock(sections.CUTSCENE_INICIO, sectionStarts.CUTSCENE_INICIO, fileName),
    outroCutscene: parseCutsceneBlock(sections.CUTSCENE_FIM, sectionStarts.CUTSCENE_FIM, fileName),
  };
}

export function parseEncounterMarkdown(rawText, fileName = 'encounter.md', cityMap = null) {
  const { meta, body, bodyStartLine } = parseFrontmatter(rawText, fileName);

  if (!meta.id || !meta.npc || !meta.location) {
    throw new StoryParseError(
      fileName,
      2,
      'Encontro extra deve definir "id", "npc" e "location" no frontmatter.',
    );
  }

  if (cityMap) {
    try {
      cityMap.resolveIndoorOppositePosition(meta.location);
    } catch (err) {
      throw new StoryParseError(
        fileName,
        2,
        `Local inválido para encontro ("location: ${meta.location}"): ${err.message}`,
      );
    }
  }

  const { sections, sectionStarts } = splitMarkdownSections(body, bodyStartLine, [
    'CUTSCENE',
    'CUTSCENE_INICIO',
  ]);
  const useIntroFallback = sections.CUTSCENE.length === 0 && sections.CUTSCENE_INICIO.length > 0;
  const blockLines = useIntroFallback ? sections.CUTSCENE_INICIO : sections.CUTSCENE;
  const startLine = useIntroFallback ? sectionStarts.CUTSCENE_INICIO : sectionStarts.CUTSCENE;
  const cutscene = parseCutsceneBlock(blockLines, startLine, fileName);

  if (!cutscene.steps || cutscene.steps.length === 0) {
    throw new StoryParseError(
      fileName,
      startLine,
      'Encontro extra deve conter uma seção "## CUTSCENE" com ao menos uma fala.',
    );
  }

  const rawRoofColor = String(meta.roof_color || '').trim();
  const roofColor = rawRoofColor || '#d6282e';
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(roofColor)) {
    throw new StoryParseError(
      fileName,
      2,
      `Cor de telhado inválida ("roof_color: ${rawRoofColor}"). Use formato hexadecimal como #d6282e.`,
    );
  }
  const roofLogo = meta.roof_logo ? validateAssetPath(meta.roof_logo, fileName, 2) : '';

  return {
    id: String(meta.id).trim(),
    npc: String(meta.npc).trim(),
    location: String(meta.location).trim(),
    prompt: String(meta.prompt || '').trim(),
    roofColor,
    roofLogo,
    cutscene,
  };
}

export function parseMapMarkdown(rawText, fileName = 'map/map.md') {
  const normalized = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const locationNames = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    let trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--')) continue;
    if (trimmed.startsWith('- ')) {
      trimmed = trimmed.slice(2).trim();
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) {
      throw new StoryParseError(fileName, i + 1, `Linha malformada em "${fileName}": "${trimmed}". Use "CODIGO: Nome".`);
    }
    const code = trimmed.slice(0, colonIdx).trim().toUpperCase();
    const name = trimmed.slice(colonIdx + 1).trim();
    if (!code || !name) {
      throw new StoryParseError(fileName, i + 1, `Código ou nome vazio em "${fileName}": "${trimmed}".`);
    }
    locationNames.set(code, name);
  }

  return locationNames;
}

export function replaceLocationCodesWithNames(text, locationNames) {
  if (!text || typeof text !== 'string' || !locationNames || locationNames.size === 0) {
    return text;
  }
  return text.replace(/\b((?:RUA|CASA|COM|PRACA)-\d+)\b/gi, (match, code) => {
    const resolved = locationNames.get(code.toUpperCase());
    return resolved || match;
  });
}
