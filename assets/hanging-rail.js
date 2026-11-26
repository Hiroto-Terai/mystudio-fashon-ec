(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SPACING_RATIO = 0.34; // garments hang side-on, so they sit close together
  const SIDE_ANGLE = -74; // degrees: how far each garment is turned from the viewer
  const HOVER_ANGLE = -44;
  const FRONT_ANGLE = 0;
  const RAIL_TOP = 26;
  const FRICTION = 0.94;
  const AUTO_SPEED = 0.35; // px per frame at 60fps
  const DRAG_THRESHOLD_PX = 5;
  const TOUCH_DRAG_THRESHOLD_PX = 10;
  const FACING_ANGLE = 6; // the quick view opens once the garment is this close to front
  const SWAY_SPRING = 0.05;
  const SWAY_DAMPING = 0.93;
  const SWAY_MAX = 10;
  const BOB_PX = 5; // floating garments drift up and down by this much
  const BOB_PERIOD_MS = 3400;
  const REST = 0.02;
  const FACE_EASE = 0.09;
  const GLIDE_MIN_MS = 1000;
  const GLIDE_MAX_MS = 1700;
  const GLIDE_MS_PER_PX = 0.8;

  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const smoothing = (rate, dt) => 1 - Math.pow(1 - rate, dt);
  const wrap = (value, size) => ((value % size) + size) % size;

  class HangingRail {
    constructor(root) {
      this.root = root;
      this.stage = root.querySelector('[data-hr-stage]');
      this.list = root.querySelector('[data-hr-track]');
      this.captionName = root.querySelector('[data-hr-caption-name]');
      this.captionPrice = root.querySelector('[data-hr-caption-price]');
      this.dialog = root.querySelector('[data-hr-dialog]');
      this.products = JSON.parse(root.querySelector('[data-hr-products]').textContent);
      this.templates = [...this.list.children].filter((li) => li.querySelector('[data-hr-piece]')).map((li) => li.cloneNode(true));
      this.isDemo = root.dataset.demo === 'true';
      this.swayStrength = Number(root.dataset.sway || 5) / 5;
      this.isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.isFloating = root.dataset.style !== 'hanger';
      this.isAutoRotate = root.dataset.autoRotate !== 'false' && !this.isReduced;
      this.offset = 0;
      this.velocity = 0;
      this.isPaused = false;
      this.isDragging = false;
      this.activeIndex = -1;
      this.hoverIndex = -1;
      this.pendingSlot = null;
      this.frame = null;
      this.lastTime = 0;
      if (!this.templates.length) return;
      this.build();
      this.bindPointer();
      this.bindDialog();
      new ResizeObserver(() => this.build()).observe(this.stage);
      this.frame = requestAnimationFrame((t) => this.tick(t));
    }

    build() {
      const width = this.stage.clientWidth;
      if (!width) return;
      const itemWidth = parseFloat(getComputedStyle(this.root).getPropertyValue('--hr-garment-width')) || 170;
      this.itemWidth = itemWidth;
      this.spacing = itemWidth * SPACING_RATIO;
      this.halfWidth = width / 2;
      this.sag = Math.min(60, width * 0.05);
      const need = Math.ceil((width + itemWidth * 3) / this.spacing);
      const count = Math.max(need, this.templates.length);
      this.count = Math.ceil(count / this.templates.length) * this.templates.length; // whole repeats keep the loop seamless
      this.total = this.count * this.spacing;
      this.list.replaceChildren();
      this.items = [];
      for (let i = 0; i < this.count; i += 1) {
        const li = this.templates[i % this.templates.length].cloneNode(true);
        li.classList.add('hanging-rail__item');
        li.dataset.hrSlot = i;
        const piece = li.querySelector('[data-hr-piece]');
        const body = li.querySelector('.hanging-rail__body');
        const wrap = li.querySelector('.hanging-rail__piece-wrap');
        const shadow = li.querySelector('.hanging-rail__shadow');
        if (i >= this.templates.length) li.querySelectorAll('[data-hr-piece]').forEach((p) => { p.tabIndex = -1; p.setAttribute('aria-hidden', 'true'); });
        this.list.append(li);
        this.items.push({ li, piece, body, wrap, shadow, index: Number(piece.dataset.hrIndex), angle: 0, velocity: 0, face: SIDE_ANGLE, faceTarget: SIDE_ANGLE, scale: 1 });
        this.bindPiece(this.items[i], i);
      }
      const height = itemWidth * 1.55 + 22 + 50;
      this.stage.style.setProperty('--hr-stage-height', `${Math.round(height + this.sag + RAIL_TOP + itemWidth * 0.25)}px`);
      this.drawRail(width);
    }

    drawRail(width) {
      let svg = this.stage.querySelector('.hanging-rail__rail');
      if (!svg) {
        svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'hanging-rail__rail');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        svg.append(path);
        this.stage.prepend(svg);
      }
      const y0 = RAIL_TOP;
      svg.setAttribute('viewBox', `0 0 ${width} ${this.sag + RAIL_TOP + 12}`);
      svg.setAttribute('width', width);
      svg.setAttribute('height', this.sag + RAIL_TOP + 12);
      svg.firstChild.setAttribute('d', `M0 ${y0} Q ${width / 2} ${y0 + this.sag * 2} ${width} ${y0}`);
    }

    railY(x) {
      const t = x / this.halfWidth;
      return RAIL_TOP + this.sag * (1 - t * t);
    }

    bindPiece(item, slot) {
      const { piece } = item;
      piece.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch' || this.activeIndex >= 0) return;
        this.hoverIndex = slot;
        this.setCaption(item.index);
      });
      piece.addEventListener('pointerleave', () => { if (this.hoverIndex === slot) this.hoverIndex = -1; });
      piece.addEventListener('focus', () => {
        this.hoverIndex = slot;
        this.setCaption(item.index);
        if (piece.matches(':focus-visible')) this.centerOn(slot);
      });
      piece.addEventListener('blur', () => { if (this.hoverIndex === slot) this.hoverIndex = -1; });
      // Pointer taps are handled on the stage (the item moves between press and release, which would lose a click); this covers the keyboard.
      piece.addEventListener('click', (event) => {
        if (event.detail === 0) this.select(slot);
      });
    }

    setCaption(productIndex) {
      const product = this.products[productIndex];
      this.captionName.textContent = product.title;
      this.captionPrice.textContent = product.price;
    }

    // Any garment glides to the center, turns to face the viewer, then opens the quick view.
    select(slot) {
      this.activeIndex = slot;
      this.pendingSlot = slot;
      this.setCaption(this.items[slot].index);
      this.centerOn(slot);
    }

    centerOn(slot) {
      const slotX = wrap(slot * this.spacing + this.offset + this.total / 2, this.total) - this.total / 2;
      this.velocity = 0;
      const duration = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, Math.abs(slotX) * GLIDE_MS_PER_PX + 600));
      this.glide = { delta: -slotX, duration, start: null, done: 0 };
    }

    bindPointer() {
      let startX = 0;
      let lastX = 0;
      let lastT = 0;
      let isDown = false;
      let downSlot = null;
      let threshold = DRAG_THRESHOLD_PX;
      this.stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        isDown = true;
        const pressed = event.target.closest('[data-hr-slot]');
        downSlot = pressed ? Number(pressed.dataset.hrSlot) : null;
        threshold = event.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
        this.pendingSlot = null;
        this.activeIndex = -1;
        this.wasDragged = false;
        startX = event.clientX;
        lastX = event.clientX;
        lastT = performance.now();
        this.glide = null;
      });
      window.addEventListener('pointermove', (event) => {
        if (!isDown) return;
        if (!this.wasDragged && Math.abs(event.clientX - startX) < threshold) return;
        if (!this.wasDragged) { this.wasDragged = true; this.isDragging = true; this.stage.setPointerCapture?.(event.pointerId); }
        const now = performance.now();
        const dx = event.clientX - lastX;
        this.offset += dx;
        this.velocity = dx / Math.max(1, now - lastT) * 16;
        this.pushSway(dx);
        lastX = event.clientX;
        lastT = now;
      });
      const end = (event) => {
        if (!isDown) return;
        isDown = false;
        this.isDragging = false;
        const isTap = event.type === 'pointerup' && !this.wasDragged && downSlot !== null;
        this.wasDragged = false;
        if (isTap) this.select(downSlot);
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      this.stage.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        this.offset -= event.deltaX;
        this.velocity = -event.deltaX * 0.4;
        this.pushSway(-event.deltaX);
      }, { passive: false });
      this.stage.addEventListener('mouseenter', () => { this.isPaused = true; });
      this.stage.addEventListener('mouseleave', () => { this.isPaused = false; });
    }

    // Moving the rail drags the hooks; each garment lags behind and swings the other way.
    pushSway(dx) {
      if (this.isReduced) return;
      this.items.forEach((item, i) => {
        const weight = 0.75 + ((i * 37) % 9) / 16;
        item.velocity -= (dx * 0.06 * this.swayStrength) / weight;
      });
    }

    tick(time) {
      const dt = Math.min(2, (time - (this.lastTime || time)) / 16.67);
      this.lastTime = time;
      const isInteracting = this.isDragging || this.activeIndex >= 0 || this.dialog.open;
      if (this.glide) {
        if (this.glide.start === null) this.glide.start = time;
        const t = Math.min(1, (time - this.glide.start) / this.glide.duration);
        const eased = easeInOut(t);
        const step = this.glide.delta * (eased - this.glide.done);
        this.glide.done = eased;
        this.offset += step;
        this.pushSway(step * 0.5);
        if (t >= 1) this.glide = null;
      } else if (!this.isDragging) {
        this.offset += this.velocity * dt;
        this.velocity *= Math.pow(FRICTION, dt);
        if (Math.abs(this.velocity) < 0.02) this.velocity = 0;
        if (this.isAutoRotate && !this.isPaused && !isInteracting && this.velocity === 0) this.offset -= AUTO_SPEED * dt;
      }
      this.time = time;
      this.render(dt);
      this.openWhenFacing();
      this.frame = requestAnimationFrame((t) => this.tick(t));
    }

    openWhenFacing() {
      if (this.pendingSlot === null || this.glide) return;
      const item = this.items[this.pendingSlot];
      if (Math.abs(item.face) > FACING_ANGLE) return;
      this.pendingSlot = null;
      this.openQuickView(item.index);
    }

    render(dt = 1) {
      if (!this.items) return;
      this.offset = wrap(this.offset, this.total);
      this.items.forEach((item, slot) => {
        const x = wrap(slot * this.spacing + this.offset + this.total / 2, this.total) - this.total / 2;
        const isVisible = Math.abs(x) < this.halfWidth + this.itemWidth * 1.2;
        item.li.style.visibility = isVisible ? '' : 'hidden';
        if (!isVisible) return;
        const isActive = slot === this.activeIndex;
        item.faceTarget = isActive ? FRONT_ANGLE : slot === this.hoverIndex ? HOVER_ANGLE : SIDE_ANGLE;
        item.face = this.isReduced ? item.faceTarget : lerp(item.face, item.faceTarget, smoothing(FACE_EASE, dt));
        const scaleTarget = isActive ? 1.16 : 1;
        item.scale = lerp(item.scale, scaleTarget, smoothing(FACE_EASE, dt));
        item.velocity = (item.velocity - item.angle * SWAY_SPRING) * SWAY_DAMPING;
        item.angle = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, item.angle + item.velocity));
        const slope = (this.railY(x + 1) - this.railY(x - 1)) / 2;
        const tilt = Math.atan(slope) * (180 / Math.PI);
        const y = this.railY(x);
        item.li.style.transform = `translate(${x + this.halfWidth - this.itemWidth / 2}px, ${y}px) rotate(${(item.angle + tilt).toFixed(2)}deg) scale(${item.scale.toFixed(3)})`;
        const bob = this.isFloating && !this.isReduced ? Math.sin((this.time || 0) / BOB_PERIOD_MS * Math.PI * 2 + item.index * 1.9) * BOB_PX * (isActive ? 0.3 : 1) : 0;
        // A flat squash stands in for the 3D turn: no per-item 3D layers, so it stays light.
        const turn = Math.max(0.04, Math.cos((item.face * Math.PI) / 180));
        item.body.style.transform = `translateY(${bob.toFixed(2)}px) scaleX(${turn.toFixed(3)})`;
        // The shadow stays on the ground: it does not bob, and it widens as the garment turns to face front.
        if (item.shadow) {
          const facing = Math.max(0.3, Math.cos((item.face * Math.PI) / 180));
          item.shadow.style.transform = `scale(${(facing * item.scale * (1 - bob * 0.03)).toFixed(3)}, 1)`;
        }
        item.li.style.zIndex = String(Math.round(1000 - Math.abs(x) + (isActive ? 2000 : 0)));
      });
    }

    bindDialog() {
      this.dialog.addEventListener('click', (event) => {
        if (event.target === this.dialog || event.target.closest('[data-hr-close]')) this.dialog.close();
      });
      this.dialog.addEventListener('close', () => { this.activeIndex = -1; this.pendingSlot = null; });
      this.dialog.addEventListener('change', () => this.syncVariant());
      this.dialog.querySelector('[data-hr-add]').addEventListener('click', () => this.addToCart());
    }

    openQuickView(productIndex) {
      const product = this.products[productIndex];
      this.current = product;
      const image = this.dialog.querySelector('[data-hr-qv-image]');
      image.src = product.image;
      image.alt = product.title;
      this.dialog.querySelector('[data-hr-qv-title]').textContent = product.title;
      this.dialog.querySelector('[data-hr-qv-link]').href = product.url;
      this.dialog.querySelector('[data-hr-qv-options]').replaceChildren(...this.renderOptions(product));
      this.dialog.querySelector('[data-hr-status]').textContent = '';
      this.syncVariant();
      this.dialog.showModal();
    }

    renderOptions(product) {
      if (product.options.length === 1 && product.variants.length === 1) return [];
      return product.options.map((name, optionIndex) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'hanging-rail__qv-option';
        const legend = document.createElement('legend');
        legend.textContent = name;
        const values = document.createElement('div');
        values.className = 'hanging-rail__qv-values';
        const firstAvailable = product.variants.find((v) => v.available) || product.variants[0];
        [...new Set(product.variants.map((v) => v.options[optionIndex]))].forEach((value) => {
          const label = document.createElement('label');
          label.className = 'hanging-rail__qv-value';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = `hr-option-${optionIndex}`;
          input.value = value;
          input.checked = firstAvailable.options[optionIndex] === value;
          const text = document.createElement('span');
          text.textContent = value;
          label.append(input, text);
          values.append(label);
        });
        fieldset.append(legend, values);
        return fieldset;
      });
    }

    selectedOptions() {
      return this.current.options.map((_, i) => {
        const checked = this.dialog.querySelector(`input[name="hr-option-${i}"]:checked`);
        return checked ? checked.value : this.current.variants[0].options[i];
      });
    }

    syncVariant() {
      const chosen = this.selectedOptions();
      const variant = this.current.variants.find((v) => v.options.every((o, i) => o === chosen[i]));
      this.currentVariant = variant;
      this.dialog.querySelector('[data-hr-qv-price]').textContent = variant ? variant.price : this.current.price;
      const button = this.dialog.querySelector('[data-hr-add]');
      button.disabled = !variant || !variant.available;
      button.textContent = variant && !variant.available ? this.root.dataset.soldOutLabel : this.root.dataset.addLabel;
    }

    async addToCart() {
      const button = this.dialog.querySelector('[data-hr-add]');
      const status = this.dialog.querySelector('[data-hr-status]');
      button.disabled = true;
      status.textContent = this.root.dataset.addingLabel;
      try {
        if (!this.isDemo && window.ArchivesCart && window.ArchivesCart.add) {
          // Reuse the theme's own add-to-cart so the cart drawer and badge update.
          this.dialog.close();
          await window.ArchivesCart.add(this.currentVariant.id, 1, null);
          return;
        }
        if (!this.isDemo) {
          const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
          const response = await fetch(`${root}cart/add.js`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ items: [{ id: this.currentVariant.id, quantity: 1 }] }),
          });
          if (!response.ok) throw new Error((await response.json()).description || response.statusText);
          document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
          if (this.root.dataset.goToCart === 'true') {
            window.location.href = `${root}cart`;
            return;
          }
        }
        status.textContent = this.root.dataset.addedLabel;
      } catch (error) {
        status.textContent = `${this.root.dataset.errorLabel} ${error.message}`;
      } finally {
        button.disabled = false;
      }
    }
  }

  const init = (scope = document) => {
    scope.querySelectorAll('[data-hanging-rail]:not([data-hr-ready])').forEach((root) => {
      root.dataset.hrReady = 'true';
      new HangingRail(root);
    });
  };

  init();
  document.addEventListener('shopify:section:load', (event) => init(event.target));
})();
