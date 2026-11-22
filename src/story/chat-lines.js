// Falas contextuais dos pedestres quando o jogador aperta Espaço perto deles.
// Cada frase tem no máximo 60 caracteres (limite do balão). Lógica pura, sem DOM.

export const RECENT_SHOT_WINDOW = 12; // segundos desde o último tiro em que os pedestres ainda estão assustados

export const CONTEXT_LINES = {
  recentShots: [
    'Pelo amor de Deus, não atira!',
    'Calma! Eu não fiz nada!',
    'Guarda essa arma, moço!',
    'Eu só tava passando...',
    'Socorro! Alguém ajuda!',
    'Não me machuca, por favor!'
  ],
  lowHealth: [
    'Você tá péssimo. Vai no hospital!',
    'Tá sangrando! Procura um médico.',
    'Cuidado, você mal tá em pé!',
    'Isso aí precisa de curativo.'
  ],
  armored: [
    'Colete? Tá indo pra guerra?',
    'Esse colete é de qual loja?',
    'Tá todo blindado, hein.',
    'Com esse colete ninguém te para.'
  ],
  gunShop: [
    'Boa escolha de loja, hein.',
    'A Armaria tem preço bom.',
    'Escolhe com calma, a loja é sua.',
    'Cuidado onde você aponta isso.'
  ],
  rich: [
    'Tá com a carteira cheia, hein?',
    'Me paga um café com esse dinheiro?',
    'Que bolso pesado!',
    'Rico agora? Lembra de mim!'
  ]
};

function pick(pool, rng) {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

// ctx = { secondsSinceShot, health, armor, insideShop, money }
// Devolve { line, scared }. "scared" = o pedestre deve fugir em vez de só conversar.
export function pickChatLine(ctx, generalPool, rng = Math.random) {
  if ((ctx.secondsSinceShot ?? Infinity) < RECENT_SHOT_WINDOW) {
    return { line: pick(CONTEXT_LINES.recentShots, rng), scared: true };
  }

  const applicable = [];
  if ((ctx.health ?? 100) < 35) applicable.push('lowHealth');
  if ((ctx.armor ?? 0) > 0) applicable.push('armored');
  if (ctx.insideShop) applicable.push('gunShop');
  if ((ctx.money ?? 0) >= 2000) applicable.push('rich');

  if (applicable.length > 0 && rng() < 0.55) {
    const key = applicable[Math.min(applicable.length - 1, Math.floor(rng() * applicable.length))];
    return { line: pick(CONTEXT_LINES[key], rng), scared: false };
  }
  return { line: pick(generalPool, rng), scared: false };
}
