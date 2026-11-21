// Códigos (cheats) digitados pelo jogador no console do F2.
// Lógica pura: recebe o texto e uma API do jogo, devolve { ok, message }.

export const CHEAT_MONEY_AMOUNT = 1000;
export const CHEAT_AMMO_AMOUNT = 60;

// Remove acentos, espaços e caixa para aceitar "Dinheiro", "MUNIÇÃO", " vida " etc.
export function normalizeCheatCode(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const CHEATS = {
  dinheiro: {
    description: `+R$ ${CHEAT_MONEY_AMOUNT}`,
    run: (api) => {
      api.addMoney(CHEAT_MONEY_AMOUNT);
      return `Você ganhou R$ ${CHEAT_MONEY_AMOUNT}.`;
    },
  },
  municao: {
    description: `+${CHEAT_AMMO_AMOUNT} balas de reserva`,
    run: (api) => {
      const added = api.addAmmo(CHEAT_AMMO_AMOUNT) ?? CHEAT_AMMO_AMOUNT;
      return added > 0 ? `Você ganhou ${added} balas de reserva.` : 'A reserva já está cheia.';
    },
  },
  colete: {
    description: 'colete cheio',
    run: (api) => {
      api.fillArmor();
      return 'Colete no máximo.';
    },
  },
  mudo: {
    description: 'liga/desliga o som',
    run: (api) => (api.toggleMute() ? 'Som desligado.' : 'Som ligado.'),
  },
  vida: {
    description: 'vida cheia',
    run: (api) => {
      api.healPlayer();
      return 'Vida restaurada.';
    },
  },
};

export function listCheatCodes() {
  return Object.entries(CHEATS).map(([code, def]) => ({ code, description: def.description }));
}

export function applyCheat(raw, api) {
  const code = normalizeCheatCode(raw);
  if (!code) {
    return { ok: false, message: 'Digite um código.' };
  }
  if (code === 'ajuda') {
    const list = listCheatCodes().map((c) => c.code).join(', ');
    return { ok: true, message: `Códigos: ${list}.` };
  }
  const cheat = CHEATS[code];
  if (!cheat) {
    return { ok: false, message: 'Código desconhecido. Digite "ajuda" para ver a lista.' };
  }
  return { ok: true, message: cheat.run(api) };
}
