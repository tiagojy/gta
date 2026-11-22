// Janela de compra da armaria + aviso "Espaço: Comprar" perto do balcão.
// Cria o próprio HTML (como o console de cheats); a lógica de compra fica em shop-data.js.

export class ShopMenu {
  constructor({ container, onBuy, onOpen, onClose } = {}) {
    this.onBuy = onBuy;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;
    this.offers = [];

    this.prompt = document.createElement('div');
    this.prompt.id = 'shop-prompt';
    this.prompt.className = 'hidden';
    this.prompt.textContent = 'Espaço: Comprar armas';

    this.root = document.createElement('div');
    this.root.id = 'shop-menu';
    this.root.className = 'hidden';
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Armaria');

    const header = document.createElement('div');
    header.className = 'shop-header';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'shop-title';
    this.moneyEl = document.createElement('div');
    this.moneyEl.className = 'shop-money';
    header.appendChild(this.titleEl);
    header.appendChild(this.moneyEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'shop-list';

    this.messageEl = document.createElement('div');
    this.messageEl.className = 'shop-message';

    const footer = document.createElement('div');
    footer.className = 'shop-footer';
    const hint = document.createElement('span');
    hint.className = 'shop-hint';
    hint.textContent = 'Números 1-5 compram a linha · Esc fecha';
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'shop-close';
    this.closeBtn.textContent = 'Sair';
    this.closeBtn.addEventListener('click', () => this.close());
    footer.appendChild(hint);
    footer.appendChild(this.closeBtn);

    this.root.appendChild(header);
    this.root.appendChild(this.listEl);
    this.root.appendChild(this.messageEl);
    this.root.appendChild(footer);

    const host = container || document.body;
    host?.appendChild(this.prompt);
    host?.appendChild(this.root);

    // Teclas usadas aqui não podem chegar ao jogo (Esc abriria a pausa, Tab o inventário...)
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      const match = /^Digit([1-9])$/.exec(e.code || '');
      if (match) {
        const offer = this.offers[Number(match[1]) - 1];
        if (offer?.enabled) this.onBuy?.(offer.id);
      }
    });
  }

  setPromptVisible(visible) {
    this.prompt.classList.toggle('hidden', !(visible && !this.isOpen));
  }

  open({ title, offers, money }) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.titleEl.textContent = title;
    this.messageEl.textContent = '';
    this.messageEl.className = 'shop-message';
    this.#render(offers, money);
    this.prompt.classList.add('hidden');
    this.root.classList.remove('hidden');
    this.onOpen?.();
    this.root.focus();
  }

  refresh({ offers, money, message = '', ok = true }) {
    this.#render(offers, money);
    this.messageEl.textContent = message;
    this.messageEl.className = `shop-message ${message ? (ok ? 'ok' : 'error') : ''}`;
  }

  #render(offers, money) {
    this.offers = offers;
    this.moneyEl.textContent = `Seu dinheiro: R$ ${Math.max(0, Math.floor(money)).toLocaleString('pt-BR')}`;
    this.listEl.textContent = '';
    offers.forEach((offer, index) => {
      const row = document.createElement('div');
      row.className = 'shop-row';

      const info = document.createElement('div');
      info.className = 'shop-info';
      const name = document.createElement('div');
      name.className = 'shop-name';
      name.textContent = `${index + 1}. ${offer.name}`;
      const detail = document.createElement('div');
      detail.className = 'shop-detail';
      detail.textContent = offer.note ? `${offer.detail} · ${offer.note}` : offer.detail;
      info.appendChild(name);
      info.appendChild(detail);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-buy';
      btn.textContent = offer.buttonLabel;
      btn.disabled = !offer.enabled;
      btn.addEventListener('click', () => this.onBuy?.(offer.id));

      row.appendChild(info);
      row.appendChild(btn);
      this.listEl.appendChild(row);
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  destroy() {
    this.isOpen = false;
    this.root.remove?.();
    this.prompt.remove?.();
  }
}
