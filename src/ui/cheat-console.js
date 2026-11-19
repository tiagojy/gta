// Caixa de texto do F2 para digitar cheats. Cria o próprio HTML e não depende do index.html.

export class CheatConsole {
  constructor({ container, onSubmit, onOpen, onClose } = {}) {
    this.onSubmit = onSubmit;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;

    this.root = document.createElement('div');
    this.root.id = 'cheat-console';
    this.root.className = 'hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Console de cheats');

    const title = document.createElement('div');
    title.className = 'cheat-title';
    title.textContent = 'CHEATS (F2 ou Esc para fechar)';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('placeholder', 'Digite um código (ou "ajuda")');

    this.messageEl = document.createElement('div');
    this.messageEl.className = 'cheat-message';

    this.root.appendChild(title);
    this.root.appendChild(this.input);
    this.root.appendChild(this.messageEl);
    (container || document.body)?.appendChild(this.root);

    // As teclas digitadas aqui não podem chegar ao jogo (M abre o mapa, P pausa, WASD anda...)
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.code === 'F2') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.#submit();
      }
    });
  }

  #submit() {
    const value = this.input.value.trim();
    if (!value) {
      this.close();
      return;
    }
    const result = this.onSubmit ? this.onSubmit(value) : { ok: false, message: 'Sem ação.' };
    this.messageEl.textContent = result?.message || '';
    this.messageEl.className = `cheat-message ${result?.ok ? 'ok' : 'error'}`;
    this.input.value = '';
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.input.value = '';
    this.messageEl.textContent = '';
    this.messageEl.className = 'cheat-message';
    this.root.classList.remove('hidden');
    this.onOpen?.();
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.input.blur();
    this.onClose?.();
  }

  destroy() {
    this.isOpen = false;
    this.root.remove?.();
  }
}
