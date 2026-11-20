// Depois de parar de mexer o mouse, o personagem volta a olhar para onde anda após este tempo.
const MOUSE_AIM_ACTIVE_MS = 4000;

export class InputManager {
  constructor(touchContainer = null) {
    this.keys = new Set();
    this.touchDirs = new Set();
    this.touchButtons = new Set();
    this.pointerBindings = new Map();
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.analogPointerId = null;
    this.analogEl = null;
    this.analogKnobEl = null;
    this.steeringWheelEl = null;
    this.actionBtnEl = null;
    this.secondaryBtnEl = null;
    this.exitBtnEl = null;
    this.handIconEl = null;
    this.accelIconEl = null;
    this.drivingMode = false;
    this.touchContainer = touchContainer;

    this.prevAction = false;
    this.prevSecondary = false;
    this.prevPause = false;
    this.prevCombo = false;
    this.prevExit = false;
    this.prevReload = false;
    this.prevLockKey = false;
    this.prevVehicleEnter = false;
    this.mouse = { clientX: 0, clientY: 0, lastMoveAt: -Infinity, down: false };
    this.pendingClick = null;
    this.secondaryHeldTime = 0;
    this.exitCooldown = 0;

    this.#bindKeyboard();
    this.#bindMouse();
    if (this.touchContainer) {
      this.#bindTouch();
      this.#updateTouchVisibility();
    }
  }

  #bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.touchDirs.clear();
      this.touchButtons.clear();
      this.pointerBindings.clear();
      this.#resetAnalog();
    });
  }

  // Mouse: mira, botão esquerdo atira e botão direito fixa o alvo. Só conta o ponteiro do tipo "mouse"
  // (toques na tela do celular continuam usando os botões virtuais).
  #bindMouse() {
    const isUiTarget = (t) => Boolean(
      t?.closest?.('button, a, input, select, textarea, [role="dialog"], .hud-pill, .modal')
    );

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.clientX = e.clientX;
      this.mouse.clientY = e.clientY;
      this.mouse.lastMoveAt = performance.now();
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || isUiTarget(e.target)) return;
      this.mouse.clientX = e.clientX;
      this.mouse.clientY = e.clientY;
      this.mouse.lastMoveAt = performance.now();
      if (e.button === 0) {
        // Botão esquerdo: atira (segurar = rajada).
        this.mouse.down = true;
      } else if (e.button === 2) {
        // Botão direito: marca/seleciona o NPC (clicar em espaço vazio solta o alvo).
        this.pendingClick = { clientX: e.clientX, clientY: e.clientY };
      }
    });

    const release = (e) => {
      if (e.pointerType === 'mouse' && (e.button === 0 || e.type === 'pointercancel')) {
        this.mouse.down = false;
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    window.addEventListener('contextmenu', (e) => {
      if (!isUiTarget(e.target)) e.preventDefault();
    });
  }

  #resetAnalog() {
    this.analogPointerId = null;
    this.analogOriginX = null;
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.analogEl?.classList.remove('active');
    if (this.analogKnobEl) {
      this.analogKnobEl.style.transform = 'translate(0px, 0px)';
    }
    if (this.steeringWheelEl) {
      this.steeringWheelEl.style.transform = 'rotate(0deg)';
    }
  }

  setDrivingMode(driving) {
    const nextMode = Boolean(driving);
    if (this.drivingMode === nextMode) {
      return;
    }
    this.drivingMode = nextMode;
    this.#resetAnalog();

    if (nextMode) {
      this.touchButtons.delete('fire');
      this.pointerBindings.forEach((binding, pointerId) => {
        if (binding.kind === 'btn' && binding.value === 'fire') {
          binding.el?.classList?.remove('active');
          this.pointerBindings.delete(pointerId);
        }
      });
    }

    if (!nextMode) {
      this.touchButtons.delete('secondary');
      this.touchButtons.delete('exit');
      this.secondaryBtnEl?.classList.remove('active');
      this.exitBtnEl?.classList.remove('active');
    }

    if (!this.touchContainer) {
      return;
    }

    this.touchContainer.classList.toggle('driving-mode', nextMode);
    this.secondaryBtnEl?.classList.toggle('hidden', !nextMode);
    this.exitBtnEl?.classList.toggle('hidden', !nextMode);
    this.handIconEl?.classList.toggle('hidden', nextMode);
    this.accelIconEl?.classList.toggle('hidden', !nextMode);

    this.analogEl?.setAttribute('aria-label', nextMode ? 'Volante virtual' : 'Direcional analógico virtual');
    this.actionBtnEl?.setAttribute('aria-label', nextMode ? 'Acelerar' : 'Ação');
  }

  #updateAnalogFromEvent(e) {
    if (!this.analogEl) return;
    const rect = this.analogEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxRadius = Math.max(24, rect.width * 0.38);

    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    if (this.drivingMode) {
      const originX = Number.isFinite(this.analogOriginX) ? this.analogOriginX : cx;
      const steerDx = e.clientX - originX;
      const raw = Math.max(-1, Math.min(1, steerDx / maxRadius));
      const deadzone = 0.12;
      if (Math.abs(raw) < deadzone) {
        this.touchMoveX = 0;
        this.touchMoveY = 0;
      } else {
        const scaled = (Math.abs(raw) - deadzone) / (1 - deadzone);
        this.touchMoveX = Math.sign(raw) * Math.pow(scaled, 1.45);
        this.touchMoveY = 0;
      }
      if (this.steeringWheelEl) {
        this.steeringWheelEl.style.transform = `rotate(${(this.touchMoveX * 75).toFixed(1)}deg)`;
      }
      return;
    }

    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const clampedX = dist > 0 ? Math.cos(angle) * clampedDist : 0;
    const clampedY = dist > 0 ? Math.sin(angle) * clampedDist : 0;

    if (this.analogKnobEl) {
      this.analogKnobEl.style.transform = `translate(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px)`;
    }

    const norm = clampedDist / maxRadius;
    const deadzone = 0.14;
    if (norm < deadzone) {
      this.touchMoveX = 0;
      this.touchMoveY = 0;
      return;
    }

    const scaled = (norm - deadzone) / (1 - deadzone);
    this.touchMoveX = Math.cos(angle) * scaled;
    this.touchMoveY = Math.sin(angle) * scaled;
  }

  #updateTouchVisibility() {
    if (!this.touchContainer) {
      return;
    }
    const isTouchCapable =
      (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    if (isTouchCapable) {
      this.touchContainer.classList.remove('hidden');
    }
  }

  #bindTouch() {
    this.analogEl = this.touchContainer.querySelector('#touch-analog');
    this.analogKnobEl = this.touchContainer.querySelector('#touch-analog-knob');
    this.steeringWheelEl = this.touchContainer.querySelector('#touch-steering-wheel');
    this.actionBtnEl = this.touchContainer.querySelector('[data-btn="action"]');
    this.secondaryBtnEl = this.touchContainer.querySelector('[data-btn="secondary"]');
    this.exitBtnEl = this.touchContainer.querySelector('[data-btn="exit"]');
    this.handIconEl = this.touchContainer.querySelector('.touch-icon-hand');
    this.accelIconEl = this.touchContainer.querySelector('.touch-icon-accel');

    if (this.analogEl) {
      this.analogEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.analogPointerId !== null) return;
        this.touchContainer.classList.remove('hidden');
        this.analogPointerId = e.pointerId;
        this.analogOriginX = e.clientX;
        this.analogEl.classList.add('active');
        try {
          this.analogEl.setPointerCapture?.(e.pointerId);
        } catch {
          // Eventos sintéticos podem não suportar pointer capture
        }
        this.#updateAnalogFromEvent(e);
      });

      const onAnalogMove = (e) => {
        if (e.pointerId !== this.analogPointerId) return;
        e.preventDefault();
        this.#updateAnalogFromEvent(e);
      };
      window.addEventListener('pointermove', onAnalogMove);
    }

    const buttons = this.touchContainer.querySelectorAll('.touch-btn');
    for (const btn of buttons) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touchContainer.classList.remove('hidden');
        const dir = btn.dataset.dir;
        const actionBtn = btn.dataset.btn;
        if (dir) {
          this.touchDirs.add(dir);
          this.pointerBindings.set(e.pointerId, { kind: 'dir', value: dir, el: btn });
        } else if (actionBtn) {
          this.touchButtons.add(actionBtn);
          this.pointerBindings.set(e.pointerId, { kind: 'btn', value: actionBtn, el: btn });
        }
        btn.classList.add('active');
      });
    }

    const releasePointer = (e) => {
      if (e.pointerId === this.analogPointerId) {
        this.#resetAnalog();
      }
      const binding = this.pointerBindings.get(e.pointerId);
      if (!binding) {
        return;
      }
      this.pointerBindings.delete(e.pointerId);
      binding.el.classList.remove('active');
      if (binding.kind === 'dir') {
        this.touchDirs.delete(binding.value);
      } else {
        this.touchButtons.delete(binding.value);
      }
    };

    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
  }

  #readGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return { moveX: 0, moveY: 0, action: false, secondary: false, exit: false, pause: false, prevPage: false, nextPage: false };
    }
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (!gp || !gp.connected) {
        continue;
      }
      let moveX = 0;
      let moveY = 0;
      const ax0 = gp.axes[0] ?? 0;
      const ax1 = gp.axes[1] ?? 0;
      if (Math.abs(ax0) > 0.25) moveX = ax0;
      if (Math.abs(ax1) > 0.25) moveY = ax1;

      if (gp.buttons[14]?.pressed) moveX = -1;
      if (gp.buttons[15]?.pressed) moveX = 1;
      if (gp.buttons[12]?.pressed) moveY = -1;
      if (gp.buttons[13]?.pressed) moveY = 1;

      const action = Boolean(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed);
      const secondary = Boolean(gp.buttons[1]?.pressed || gp.buttons[2]?.pressed || gp.buttons[6]?.pressed);
      const exit = Boolean(gp.buttons[3]?.pressed);
      const pause = Boolean(gp.buttons[9]?.pressed);
      const mapToggle = Boolean(gp.buttons[8]?.pressed);
      const prevPage = Boolean(gp.buttons[4]?.pressed);
      const nextPage = Boolean(gp.buttons[5]?.pressed);
      const rightStickY = Math.abs(gp.axes[3] ?? 0) > 0.25 ? gp.axes[3] : 0;
      const zoomIn = Boolean(gp.buttons[5]?.pressed || gp.buttons[7]?.pressed || rightStickY < -0.25);
      const zoomOut = Boolean(gp.buttons[4]?.pressed || gp.buttons[6]?.pressed || rightStickY > 0.25);
      const resetZoom = Boolean(gp.buttons[3]?.pressed || gp.buttons[11]?.pressed);
      const fire = Boolean(gp.buttons[5]?.pressed);
      const reload = Boolean(gp.buttons[4]?.pressed);
      return { moveX, moveY, action, secondary, exit, pause, mapToggle, prevPage, nextPage, zoomIn, zoomOut, resetZoom, fire, reload };
    }
    return {
      moveX: 0,
      moveY: 0,
      action: false,
      secondary: false,
      exit: false,
      pause: false,
      mapToggle: false,
      prevPage: false,
      nextPage: false,
      zoomIn: false,
      zoomOut: false,
      resetZoom: false,
      fire: false,
      reload: false,
    };
  }

  update(dt) {
    let moveX = 0;
    let moveY = 0;

    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.touchDirs.has('left')) moveX -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.touchDirs.has('right')) moveX += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touchDirs.has('up')) moveY -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS') || this.touchDirs.has('down')) moveY += 1;

    if (Math.abs(this.touchMoveX) > 0 || Math.abs(this.touchMoveY) > 0) {
      moveX += this.touchMoveX;
      moveY += this.touchMoveY;
    }

    let actionPressed =
      this.keys.has('Space') ||
      this.keys.has('Enter') ||
      this.keys.has('KeyZ') ||
      this.touchButtons.has('action');

    let secondaryPressed =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('KeyX') ||
      this.keys.has('Backspace') ||
      this.touchButtons.has('secondary');

    const gp = this.#readGamepad();
    const firePressed = Boolean(this.touchButtons.has('fire') || gp.fire || this.mouse.down);
    const reloadPressed = Boolean(this.keys.has('KeyR') || gp.reload);
    const reloadJustPressed = reloadPressed && !this.prevReload;
    this.prevReload = reloadPressed;
    const lockKeyHeld = this.keys.has('KeyG');
    const lockNearestJustPressed = lockKeyHeld && !this.prevLockKey;
    this.prevLockKey = lockKeyHeld;
    const lockClick = this.pendingClick;
    this.pendingClick = null;
    const mouseAim = {
      active: this.mouse.down || (performance.now() - this.mouse.lastMoveAt) < MOUSE_AIM_ACTIVE_MS,
      clientX: this.mouse.clientX,
      clientY: this.mouse.clientY
    };
    if (Math.abs(gp.moveX) > 0) moveX = gp.moveX;
    if (Math.abs(gp.moveY) > 0) moveY = gp.moveY;
    actionPressed = actionPressed || gp.action;
    secondaryPressed = secondaryPressed || gp.secondary;

    // Direção estilo jogo de carro: W/↑ acelera; S/↓ (ou Shift/X) freia e dá ré.
    // O Espaço não acelera mais. Toque/gamepad continuam usando os botões de ação.
    const throttlePressed = Boolean(
      this.keys.has('KeyW') ||
      this.keys.has('ArrowUp') ||
      this.touchButtons.has('action') ||
      gp.action
    );
    const brakePressed = Boolean(
      this.keys.has('KeyS') ||
      this.keys.has('ArrowDown') ||
      secondaryPressed
    );

    // Entrar/roubar veículo: tecla F (toque e gamepad seguem usando o botão de ação).
    const vehicleEnterPressed = Boolean(
      this.keys.has('KeyF') ||
      this.touchButtons.has('action') ||
      gp.action
    );
    const vehicleEnterJustPressed = vehicleEnterPressed && !this.prevVehicleEnter;
    this.prevVehicleEnter = vehicleEnterPressed;
    const pausePressed = Boolean(gp.pause);

    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    const exitPressed = this.touchButtons.has('exit') || gp.exit;
    const exitJustPressed = exitPressed && !this.prevExit;

    const actionJustPressed = actionPressed && !this.prevAction;
    const secondaryJustPressed = secondaryPressed && !this.prevSecondary;
    const pauseJustPressed = pausePressed && !this.prevPause;
    const mapTogglePressed = Boolean(gp.mapToggle);
    const mapToggleJustPressed = mapTogglePressed && !this.prevMapToggle;
    const comboNow = actionPressed && secondaryPressed;
    const comboExitJustPressed = comboNow && !this.prevCombo;

    if (secondaryPressed && !actionPressed) {
      this.secondaryHeldTime += dt;
    } else {
      this.secondaryHeldTime = 0;
    }

    if (this.exitCooldown > 0) {
      this.exitCooldown = Math.max(0, this.exitCooldown - dt);
    }

    this.prevAction = actionPressed;
    this.prevSecondary = secondaryPressed;
    this.prevPause = pausePressed;
    this.prevMapToggle = mapTogglePressed;
    this.prevCombo = comboNow;
    this.prevExit = exitPressed;

    const prevPagePressed = Boolean(
      this.keys.has('KeyQ') ||
      this.keys.has('PageUp') ||
      this.keys.has('BracketLeft') ||
      gp.prevPage
    );
    const nextPagePressed = Boolean(
      this.keys.has('KeyE') ||
      this.keys.has('PageDown') ||
      this.keys.has('BracketRight') ||
      gp.nextPage
    );
    const zoomInPressed = Boolean(
      this.keys.has('Equal') ||
      this.keys.has('NumpadAdd') ||
      gp.zoomIn
    );
    const zoomOutPressed = Boolean(
      this.keys.has('Minus') ||
      this.keys.has('NumpadSubtract') ||
      gp.zoomOut
    );
    const resetZoomPressed = Boolean(
      this.keys.has('Digit0') ||
      this.keys.has('Numpad0') ||
      gp.resetZoom
    );
    const resetZoomJustPressed = resetZoomPressed && !this.prevResetZoom;
    this.prevResetZoom = resetZoomPressed;

    return {
      moveX,
      moveY,
      actionPressed,
      actionJustPressed,
      secondaryPressed,
      secondaryJustPressed,
      prevPagePressed,
      nextPagePressed,
      zoomInPressed,
      zoomOutPressed,
      resetZoomJustPressed,
      exitJustPressed,
      pauseJustPressed,
      mapToggleJustPressed,
      firePressed,
      reloadJustPressed,
      mouseAim,
      lockClick,
      lockNearestJustPressed,
      throttlePressed,
      brakePressed,
      vehicleEnterJustPressed,
      secondaryHeldTime: this.secondaryHeldTime,
      comboExitJustPressed,
      canTriggerHoldExit: this.exitCooldown === 0 && this.secondaryHeldTime >= 0.6
    };
  }

  consumeExitTrigger() {
    this.secondaryHeldTime = 0;
    this.exitCooldown = 0.45;
  }
}
