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

test('clique esquerdo atira enquanto segurado e não marca alvo', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, clientX: 400, clientY: 200, target: canvasTarget });

  let snap = input.update(0.016);
  assert.equal(snap.firePressed, true);
  assert.equal(snap.lockClick, null);

  snap = input.update(0.016);
  assert.equal(snap.firePressed, true);

  win.dispatch('pointerup', { pointerType: 'mouse', button: 0 });
  assert.equal(input.update(0.016).firePressed, false);
});

test('clique direito marca o alvo uma única vez e não atira', async () => {
  const { win, input } = await createInput();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 2, clientX: 400, clientY: 200, target: canvasTarget });

  let snap = input.update(0.016);
  assert.deepEqual(snap.lockClick, { clientX: 400, clientY: 200 });
  assert.equal(snap.firePressed, false);

  snap = input.update(0.016);
  assert.equal(snap.lockClick, null);
});

test('tecla F não atira mais', async () => {
  const { win, input } = await createInput();
  win.dispatch('keydown', { code: 'KeyF' });
  assert.equal(input.update(0.016).firePressed, false);
});

test('tecla F pede para entrar no veículo uma vez por aperto', async () => {
  const { win, input } = await createInput();
  win.dispatch('keydown', { code: 'KeyF' });
  assert.equal(input.update(0.016).vehicleEnterJustPressed, true);
  assert.equal(input.update(0.016).vehicleEnterJustPressed, false);
  win.dispatch('keyup', { code: 'KeyF' });
  assert.equal(input.update(0.016).vehicleEnterJustPressed, false);
  win.dispatch('keydown', { code: 'KeyF' });
  assert.equal(input.update(0.016).vehicleEnterJustPressed, true);
});

test('Espaço não acelera nem entra no veículo; W/S aceleram e freiam', async () => {
  const { win, input } = await createInput();
  win.dispatch('keydown', { code: 'Space' });
  let snap = input.update(0.016);
  assert.equal(snap.actionPressed, true);
  assert.equal(snap.throttlePressed, false);
  assert.equal(snap.vehicleEnterJustPressed, false);
  win.dispatch('keyup', { code: 'Space' });

  win.dispatch('keydown', { code: 'KeyW' });
  snap = input.update(0.016);
  assert.equal(snap.throttlePressed, true);
  assert.equal(snap.brakePressed, false);
  win.dispatch('keyup', { code: 'KeyW' });

  win.dispatch('keydown', { code: 'KeyS' });
  snap = input.update(0.016);
  assert.equal(snap.throttlePressed, false);
  assert.equal(snap.brakePressed, true);
  assert.equal(snap.secondaryPressed, false);
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

test('menu do navegador é bloqueado fora da interface', async () => {
  const { win } = await createInput();
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

test('teclas 1 a 5 escolhem a arma uma vez por aperto', async () => {
  const { win, input } = await createInput();
  assert.equal(input.update(0.016).weaponSlotJustPressed, null);

  win.dispatch('keydown', { code: 'Digit2' });
  assert.equal(input.update(0.016).weaponSlotJustPressed, 1);
  assert.equal(input.update(0.016).weaponSlotJustPressed, null);

  win.dispatch('keyup', { code: 'Digit2' });
  input.update(0.016);
  win.dispatch('keydown', { code: 'Digit1' });
  assert.equal(input.update(0.016).weaponSlotJustPressed, 0);
});

test('roda do mouse troca de arma: para baixo = próxima, para cima = anterior', async () => {
  const { win, input } = await createInput();
  win.dispatch('wheel', { deltaY: 100, target: canvasTarget });
  assert.equal(input.update(0.016).weaponCycle, 1);
  assert.equal(input.update(0.016).weaponCycle, 0);

  win.dispatch('wheel', { deltaY: -120, target: canvasTarget });
  assert.equal(input.update(0.016).weaponCycle, -1);
});

test('roda com Ctrl (zoom do navegador) ou sobre a interface não troca de arma', async () => {
  const { win, input } = await createInput();
  win.dispatch('wheel', { deltaY: 100, ctrlKey: true, target: canvasTarget });
  win.dispatch('wheel', { deltaY: 100, target: uiTarget });
  assert.equal(input.update(0.016).weaponCycle, 0);
});
