import test from 'node:test';
import assert from 'node:assert/strict';

function setupWindow() {
  const listeners = new Map();
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      const ev = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false, ...event };
      for (const fn of listeners.get(type) || []) fn(ev);
      return ev;
    },
  };
  return globalThis.window;
}

const canvasTarget = { closest: () => null };
const uiTarget = { closest: () => ({}) };

async function createInput() {
  const win = setupWindow();
  const { InputManager } = await import('../src/input/input-manager.js');
  return { win, input: new InputManager(null) };
}

test('mover o mouse ativa a mira com a posição do cursor', async () => {
  const { win, input } = await createInput();
  assert.equal(input.update(0.016).mouseAim.active, false);

  win.dispatch('pointermove', { pointerType: 'mouse', clientX: 300, clientY: 150 });
  const snap = input.update(0.016);
  assert.equal(snap.mouseAim.active, true);
  assert.equal(snap.mouseAim.clientX, 300);
  assert.equal(snap.mouseAim.clientY, 150);
});

test('clique esquerdo atira enquanto segurado e informa o ponto clicado uma única vez', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, clientX: 400, clientY: 200, target: canvasTarget });

  let snap = input.update(0.016);
  assert.equal(snap.firePressed, true);
  assert.deepEqual(snap.lockClick, { clientX: 400, clientY: 200 });

  snap = input.update(0.016);
  assert.equal(snap.firePressed, true);
  assert.equal(snap.lockClick, null);

  win.dispatch('pointerup', { pointerType: 'mouse', button: 0 });
  assert.equal(input.update(0.016).firePressed, false);
});

test('clique em botão ou janela da interface não atira', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, target: uiTarget });
  const snap = input.update(0.016);
  assert.equal(snap.firePressed, false);
  assert.equal(snap.lockClick, null);
});

test('toque na tela (celular) não vira clique de mouse', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'touch', button: 0, clientX: 50, clientY: 50, target: canvasTarget });
  win.dispatch('pointermove', { pointerType: 'touch', clientX: 60, clientY: 60 });
  const snap = input.update(0.016);
  assert.equal(snap.firePressed, false);
  assert.equal(snap.mouseAim.active, false);
});

test('botão direito pede para soltar o alvo e o menu do navegador é bloqueado', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 2, clientX: 5, clientY: 5, target: canvasTarget });
  assert.equal(input.update(0.016).clearLockJustPressed, true);
  assert.equal(input.update(0.016).clearLockJustPressed, false);

  const ev = win.dispatch('contextmenu', { target: canvasTarget });
  assert.equal(ev.defaultPrevented, true);
});

test('tecla G fixa o alvo mais próximo uma vez por aperto', async () => {
  const { win, input } = await createInput();
  win.dispatch('keydown', { code: 'KeyG' });
  assert.equal(input.update(0.016).lockNearestJustPressed, true);
  assert.equal(input.update(0.016).lockNearestJustPressed, false);
  win.dispatch('keyup', { code: 'KeyG' });
  input.update(0.016); // um quadro com a tecla solta
  win.dispatch('keydown', { code: 'KeyG' });
  assert.equal(input.update(0.016).lockNearestJustPressed, true);
});
