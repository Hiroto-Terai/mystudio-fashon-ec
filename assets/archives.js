/* ============================================================
   ARCHIVES Studio — global theme behaviour
   Sprint 0: header (search toggle, mobile menu), cart drawer open/close,
   wishlist (localStorage) + header badges.
   Sprint 4: Ajax cart — add/change re-renders the cart drawer (and the
   cart page, when open) via the Section Rendering API, plus a
   client-side coupon demo.
   ============================================================ */
(function () {
  'use strict';

  var WISHLIST_KEY = 'archives:wishlist';
  var COUPON_KEY = 'archives:coupon';
  /* Client-side discount demo only: Shopify has no public API to apply a
     real discount code from the storefront without redirecting through
     checkout, so this recalculates and displays the discount locally.
     The actual order total is whatever applies at checkout. */
  var COUPONS = { WINTER10: 0.10, ARCHIVE5: 0.05 };
  var CART_SECTION_ID = 'cart-drawer';
  var MAIN_CART_SECTION_ID = 'main-cart';

  /* ---------- small helpers ---------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  /* ---------- Wishlist store (localStorage) ---------- */
  var Wishlist = {
    read: function () {
      try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []; }
      catch (e) { return []; }
    },
    write: function (list) {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
      document.dispatchEvent(new CustomEvent('archives:wishlist:change', { detail: list }));
    },
    has: function (id) { return this.read().indexOf(String(id)) !== -1; },
    toggle: function (id) {
      id = String(id);
      var list = this.read();
      var i = list.indexOf(id);
      if (i === -1) { list.push(id); } else { list.splice(i, 1); }
      this.write(list);
      return i === -1;
    },
    count: function () { return this.read().length; }
  };
  window.ArchivesWishlist = Wishlist;

  function syncWishlistBadges() {
    var count = Wishlist.count();
    qsa('[data-wishlist-badge]').forEach(function (badge) {
      badge.textContent = count;
      badge.hidden = count === 0;
    });
    qsa('[data-wishlist-toggle]').forEach(function (btn) {
      var active = Wishlist.has(btn.getAttribute('data-wishlist-toggle'));
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function bindWishlistToggles() {
    qsa('[data-wishlist-toggle]').forEach(function (btn) {
      if (btn.__asBound) return;
      btn.__asBound = true;
      on(btn, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        Wishlist.toggle(btn.getAttribute('data-wishlist-toggle'));
      });
    });
  }

  /* ---------- Header: search + mobile menu ---------- */
  function bindHeader() {
    var body = document.body;

    qsa('[data-search-toggle]').forEach(function (btn) {
      on(btn, 'click', function () {
        var panel = qs('[data-search-panel]');
        if (!panel) return;
        var open = panel.hasAttribute('hidden');
        if (open) { panel.removeAttribute('hidden'); var input = qs('input', panel); if (input) input.focus(); }
        else { panel.setAttribute('hidden', ''); }
      });
    });

    qsa('[data-menu-toggle]').forEach(function (btn) {
      on(btn, 'click', function () {
        var menu = qs('[data-mobile-menu]');
        if (!menu) return;
        var open = menu.hasAttribute('hidden');
        if (open) { menu.removeAttribute('hidden'); body.classList.add('as-menu-open'); }
        else { menu.setAttribute('hidden', ''); body.classList.remove('as-menu-open'); }
      });
    });
  }

  /* ---------- Cart drawer open/close ---------- */
  var CartDrawer = {
    el: function () { return qs('[data-cart-drawer]'); },
    scrim: function () { return qs('[data-cart-scrim]'); },
    open: function () {
      var d = this.el(), s = this.scrim();
      if (!d) return;
      if (s) s.removeAttribute('hidden');
      d.removeAttribute('hidden');
      requestAnimationFrame(function () { d.classList.add('is-open'); if (s) s.classList.add('is-open'); });
      document.body.classList.add('as-drawer-open');
    },
    close: function () {
      var d = this.el(), s = this.scrim();
      if (!d) return;
      d.classList.remove('is-open');
      if (s) s.classList.remove('is-open');
      document.body.classList.remove('as-drawer-open');
      window.setTimeout(function () {
        d.setAttribute('hidden', '');
        if (s) s.setAttribute('hidden', '');
      }, 480);
    }
  };
  window.ArchivesCart = window.ArchivesCart || {};
  window.ArchivesCart.drawer = CartDrawer;

  function bindCartDrawer() {
    /* Delegated so open/close survive Section Rendering swaps of the drawer contents */
    on(document, 'click', function (e) {
      if (e.target.closest('[data-cart-open]')) { e.preventDefault(); CartDrawer.open(); }
      else if (e.target.closest('[data-cart-close]')) { e.preventDefault(); CartDrawer.close(); }
      else if (e.target.closest('[data-cart-scrim]')) { CartDrawer.close(); }
    });
    on(document, 'keydown', function (e) { if (e.key === 'Escape') CartDrawer.close(); });
  }

  /* ---------- Quick add (product cards -> /cart/add.js) ---------- */
  function updateCartBadge() {
    fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        qsa('[data-cart-badge]').forEach(function (badge) {
          badge.textContent = cart.item_count;
          badge.hidden = cart.item_count === 0;
        });
      });
  }

  /* ---------- Ajax cart: Section Rendering + coupon demo ---------- */

  /* Standard Shopify money formatter driven by {{ shop.money_format }},
     exposed once as window.ArchivesMoneyFormat by sections/cart-drawer.liquid,
     so JS-computed discount/total labels match the store's `| money` output. */
  function formatMoney(cents) {
    var format = window.ArchivesMoneyFormat || '${{amount}}';
    var placeholder = /\{\{\s*(\w+)\s*\}\}/;
    function withDelimiters(number, precision, thousands, decimalSep) {
      precision = typeof precision === 'undefined' ? 2 : precision;
      thousands = typeof thousands === 'undefined' ? ',' : thousands;
      decimalSep = typeof decimalSep === 'undefined' ? '.' : decimalSep;
      if (isNaN(number) || number == null) number = 0;
      number = (number / 100.0).toFixed(precision);
      var parts = number.split('.');
      var dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
      var rest = parts[1] ? decimalSep + parts[1] : '';
      return dollars + rest;
    }
    var match = format.match(placeholder);
    var key = match ? match[1] : 'amount';
    var value;
    switch (key) {
      case 'amount_no_decimals': value = withDelimiters(cents, 0); break;
      case 'amount_with_comma_separator': value = withDelimiters(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = withDelimiters(cents, 0, '.', ','); break;
      default: value = withDelimiters(cents, 2);
    }
    return match ? format.replace(placeholder, value) : format;
  }

  function cartDrawerContents() { return qs('[data-cart-drawer-contents]'); }
  function mainCartContents() { return qs('[data-main-cart-contents]'); }

  function parseSectionFragment(html, selector) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.querySelector(selector);
  }

  function swapContents(current, html, selector) {
    if (!current || !html) return;
    var fresh = parseSectionFragment(html, selector);
    if (!fresh) return;
    current.innerHTML = fresh.innerHTML;
    var cents = fresh.getAttribute('data-cart-subtotal-cents');
    if (cents !== null) current.setAttribute('data-cart-subtotal-cents', cents);
  }

  function requestedSectionIds() {
    var ids = [CART_SECTION_ID];
    if (mainCartContents()) ids.push(MAIN_CART_SECTION_ID);
    return ids;
  }

  function applySectionsResponse(sections) {
    if (!sections) return;
    if (sections[CART_SECTION_ID]) swapContents(cartDrawerContents(), sections[CART_SECTION_ID], '[data-cart-drawer-contents]');
    if (sections[MAIN_CART_SECTION_ID]) swapContents(mainCartContents(), sections[MAIN_CART_SECTION_ID], '[data-main-cart-contents]');
    syncCouponUI();
  }

  /* addToCart() is shared by product-card quick-add and the PDP form so
     both go through the same /cart/add.js -> re-render -> badge -> drawer
     flow. Section Rendering (sections param) re-renders the drawer's
     markup (items/subtotal/free-ship bar) in the same request instead of
     leaving it stuck on its server-first-paint state. */
  function addToCart(variantId, quantity, button) {
    var label = button ? button.textContent : '';
    if (button) button.disabled = true;
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        id: variantId,
        quantity: quantity,
        sections: requestedSectionIds().join(','),
        sections_url: window.location.pathname
      })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error((err && err.description) || 'Could not add to cart');
          });
        }
        return res.json();
      })
      .then(function (result) {
        if (result && result.sections) {
          applySectionsResponse(result.sections);
        } else {
          /* Fallback for stores/proxies that strip the sections param on
             /cart/add.js: fetch the rendered sections separately. */
          return fetch('/?sections=' + requestedSectionIds().join(','), { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(applySectionsResponse);
        }
      })
      .then(function () {
        updateCartBadge();
        CartDrawer.open();
      })
      .catch(function (err) {
        window.alert(err.message || 'Could not add to cart');
      })
      .then(function () {
        if (button) {
          button.disabled = false;
          if (label) button.textContent = label;
        }
      });
  }

  function bindQuickAdd() {
    qsa('[data-quick-add]').forEach(function (btn) {
      if (btn.__asBound) return;
      btn.__asBound = true;
      on(btn, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        var variantId = btn.getAttribute('data-variant-id');
        if (!variantId) return;
        addToCart(variantId, 1, btn);
      });
    });
  }

  /* ---------- Cart line quantity +/- and remove (drawer + cart page) ---------- */
  var lineChangeBusy = false;

  function changeLine(key, quantity) {
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        id: key,
        quantity: quantity,
        sections: requestedSectionIds().join(','),
        sections_url: window.location.pathname
      })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error((err && err.description) || 'Could not update cart');
          });
        }
        return res.json();
      })
      .then(function (cart) {
        applySectionsResponse(cart.sections);
        qsa('[data-cart-badge]').forEach(function (badge) {
          badge.textContent = cart.item_count;
          badge.hidden = cart.item_count === 0;
        });
      });
  }

  function bindCartLineControls() {
    if (document.__cartLineBound) return;
    document.__cartLineBound = true;
    on(document, 'click', function (e) {
      var isDec = e.target.closest('[data-qty-dec]');
      var isInc = e.target.closest('[data-qty-inc]');
      var isRemove = e.target.closest('[data-item-remove]');
      if (!isDec && !isInc && !isRemove) return;
      var row = e.target.closest('[data-cart-item]');
      if (!row || lineChangeBusy) return;
      e.preventDefault();
      var key = row.getAttribute('data-key');
      var quantity = parseInt(row.getAttribute('data-quantity'), 10) || 0;
      if (isRemove) quantity = 0;
      else if (isDec) quantity = Math.max(0, quantity - 1);
      else if (isInc) quantity = quantity + 1;
      lineChangeBusy = true;
      changeLine(key, quantity)
        .catch(function (err) { window.alert(err.message || 'Could not update cart'); })
        .then(function () { lineChangeBusy = false; });
    });
  }

  /* ---------- Coupon demo (client-side subtotal discount) ---------- */
  function readCoupon() {
    try { return sessionStorage.getItem(COUPON_KEY); } catch (e) { return null; }
  }
  function writeCoupon(code) {
    try {
      if (code) sessionStorage.setItem(COUPON_KEY, code);
      else sessionStorage.removeItem(COUPON_KEY);
    } catch (e) { /* sessionStorage unavailable (private mode etc.) - coupon just won't persist across renders */ }
  }
  function activeCoupon() {
    var code = readCoupon();
    if (code && !COUPONS.hasOwnProperty(code)) { writeCoupon(null); code = null; }
    return code;
  }

  function renderDiscountInto(root, code) {
    if (!root) return;
    var subtotalCents = parseInt(root.getAttribute('data-cart-subtotal-cents'), 10) || 0;
    var rate = code ? COUPONS[code] : 0;
    var discountCents = code ? Math.round(subtotalCents * rate) : 0;
    var row = qs('[data-cart-discount-row]', root);
    var amountEl = qs('[data-cart-discount]', root);
    if (row) row.hidden = !code;
    if (amountEl) amountEl.textContent = code ? ('−' + formatMoney(discountCents)) : '';
    var totalEl = qs('[data-cart-total]', root);
    if (totalEl) totalEl.textContent = formatMoney(Math.max(0, subtotalCents - discountCents));
  }

  function syncCouponUI(showInvalid) {
    var code = activeCoupon();
    renderDiscountInto(cartDrawerContents(), code);
    renderDiscountInto(mainCartContents(), code);
    var msgEl = qs('[data-coupon-msg]', cartDrawerContents());
    if (!msgEl) return;
    if (showInvalid) {
      msgEl.hidden = false;
      msgEl.textContent = msgEl.getAttribute('data-invalid-text') || 'Invalid code';
    } else if (code) {
      msgEl.hidden = false;
      var template = msgEl.getAttribute('data-applied-template') || '__CODE__ — __PERCENT__% off';
      msgEl.textContent = template.replace('__CODE__', code).replace('__PERCENT__', Math.round(COUPONS[code] * 100));
    } else {
      msgEl.hidden = true;
      msgEl.textContent = '';
    }
  }

  function bindCoupon() {
    if (document.__couponBound) return;
    document.__couponBound = true;
    function apply() {
      var input = qs('[data-coupon-input]', cartDrawerContents());
      var raw = input ? input.value.trim().toUpperCase() : '';
      if (!raw) return;
      if (COUPONS.hasOwnProperty(raw)) {
        writeCoupon(raw);
        syncCouponUI(false);
      } else {
        writeCoupon(null);
        syncCouponUI(true);
      }
    }
    on(document, 'click', function (e) {
      if (e.target.closest('[data-coupon-apply]')) { e.preventDefault(); apply(); }
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest('[data-coupon-input]')) { e.preventDefault(); apply(); }
    });
  }

  /* ---------- PDP: member price toggle (demo) ---------- */
  function applyMemberState(root) {
    var active = root.getAttribute('data-member') === 'true';
    var price = qs('[data-pdp-price]', root);
    var memberPrice = qs('[data-pdp-member-price]', root);
    var compare = qs('[data-pdp-compare]', root);
    var banner = qs('[data-member-banner]', root);
    var dot = qs('[data-member-dot]', root);
    var title = qs('[data-member-title]', root);
    var desc = qs('[data-member-desc]', root);
    if (price) price.classList.toggle('is-strike', active);
    if (memberPrice) memberPrice.hidden = !active;
    if (compare) compare.hidden = active || root.getAttribute('data-on-sale') !== 'true';
    if (banner) banner.classList.toggle('is-active', active);
    if (dot) dot.classList.toggle('is-active', active);
    if (title) title.textContent = active ? title.getAttribute('data-member-text') : title.getAttribute('data-guest-text');
    if (desc) desc.textContent = active ? desc.getAttribute('data-member-text') : desc.getAttribute('data-guest-text');
  }

  function bindMemberToggle() {
    qsa('[data-pdp-root]').forEach(function (root) {
      applyMemberState(root);
      var banner = qs('[data-member-banner]', root);
      if (!banner || banner.__asBound) return;
      banner.__asBound = true;
      on(banner, 'click', function () {
        var active = root.getAttribute('data-member') === 'true';
        root.setAttribute('data-member', active ? 'false' : 'true');
        applyMemberState(root);
      });
    });
  }

  /* ---------- PDP: variant picker (options -> matching variant -> price/stock/cart) ---------- */
  function bindProductVariantPicker() {
    qsa('[data-pdp-root]').forEach(function (root) {
      if (root.__variantBound) return;
      root.__variantBound = true;

      var variantsEl = qs('[data-product-variants]', root);
      var variants = [];
      if (variantsEl) {
        try { variants = JSON.parse(variantsEl.textContent); } catch (e) { variants = []; }
      }
      var optionGroups = qsa('[data-option-position]', root);
      var form = qs('[data-product-form]', root);
      var idInput = qs('[data-variant-id-input]', root);
      var qtyInput = qs('[data-qty-input]', root);
      var addBtn = qs('[data-add-to-cart]', root);
      var priceEl = qs('[data-pdp-price]', root);
      var memberPriceEl = qs('[data-pdp-member-price]', root);
      var compareEl = qs('[data-pdp-compare]', root);
      var stockLine = qs('[data-stock-line]', root);
      var stockDot = qs('[data-stock-dot]', root);
      var purchaseBlock = qs('[data-pdp-purchase]', root);
      var soldoutBlock = qs('[data-pdp-soldout]', root);
      var lowStockThreshold = parseInt(root.getAttribute('data-low-stock-threshold'), 10) || 5;

      function selectedOptions() {
        return optionGroups.map(function (group) {
          var active = qs('.is-selected', group);
          return active ? active.getAttribute('data-value') : null;
        });
      }

      function findMatchingVariant() {
        var selected = selectedOptions();
        for (var i = 0; i < variants.length; i++) {
          var v = variants[i];
          var ok = true;
          for (var j = 0; j < selected.length; j++) {
            if (selected[j] !== null && v.options[j] !== selected[j]) { ok = false; break; }
          }
          if (ok) return v;
        }
        return null;
      }

      function refreshAddLabel() {
        if (!addBtn || addBtn.disabled) return;
        var qty = qtyInput ? qtyInput.value : 1;
        addBtn.textContent = addBtn.getAttribute('data-label-default') + ' — ' + qty;
      }

      function updateOptionAvailability() {
        var sel = selectedOptions();
        optionGroups.forEach(function (group, gi) {
          qsa('[data-option-value]', group).forEach(function (btn) {
            var candidate = sel.slice();
            candidate[gi] = btn.getAttribute('data-value');
            var anyAvail = variants.some(function (v) {
              if (!v.available) return false;
              for (var j = 0; j < candidate.length; j++) {
                if (candidate[j] !== null && v.options[j] !== candidate[j]) return false;
              }
              return true;
            });
            btn.classList.toggle('is-soldout', !anyAvail);
          });
        });
      }

      function applyVariant(variant) {
        if (idInput) idInput.value = variant ? variant.id : '';
        if (priceEl && variant) priceEl.innerHTML = variant.price_html;
        if (memberPriceEl && variant) memberPriceEl.innerHTML = variant.member_price_html;
        if (variant) root.setAttribute('data-on-sale', variant.on_sale ? 'true' : 'false');
        if (compareEl && variant) {
          compareEl.innerHTML = variant.compare_html || '';
          var memberActive = root.getAttribute('data-member') === 'true';
          compareEl.hidden = memberActive || !variant.on_sale;
        }

        var available = variant ? variant.available : false;

        if (stockLine) {
          if (!variant || !available) {
            stockLine.textContent = stockLine.getAttribute('data-text-unavailable');
          } else if (variant.inventory_management === 'shopify' && typeof variant.inventory_quantity === 'number' && variant.inventory_quantity <= lowStockThreshold) {
            stockLine.textContent = stockLine.getAttribute('data-text-low').replace('{qty}', variant.inventory_quantity);
          } else {
            stockLine.textContent = stockLine.getAttribute('data-text-available');
          }
        }
        if (stockDot) {
          if (!variant || !available) stockDot.style.background = 'var(--text-tertiary)';
          else if (variant.inventory_management === 'shopify' && typeof variant.inventory_quantity === 'number' && variant.inventory_quantity <= lowStockThreshold) stockDot.style.background = 'var(--color-ink)';
          else stockDot.style.background = '#8fb98f';
        }

        if (available) {
          if (purchaseBlock) purchaseBlock.hidden = false;
          if (soldoutBlock) soldoutBlock.hidden = true;
          if (addBtn) { addBtn.disabled = false; refreshAddLabel(); }
        } else {
          if (purchaseBlock) purchaseBlock.hidden = true;
          if (soldoutBlock) soldoutBlock.hidden = false;
          if (addBtn) { addBtn.disabled = true; addBtn.textContent = addBtn.getAttribute('data-label-soldout'); }
        }
      }

      optionGroups.forEach(function (group) {
        qsa('[data-option-value]', group).forEach(function (btn) {
          on(btn, 'click', function () {
            if (btn.disabled) return;
            qsa('[data-option-value]', group).forEach(function (b) {
              b.classList.remove('is-selected');
              b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('is-selected');
            btn.setAttribute('aria-pressed', 'true');
            var idx = group.getAttribute('data-option-position');
            var label = qs('[data-option-selected-label="' + idx + '"]', root);
            if (label) label.textContent = btn.getAttribute('data-value');
            applyVariant(findMatchingVariant());
            updateOptionAvailability();
          });
        });
      });

      on(qs('[data-qty-dec]', root), 'click', function () {
        if (!qtyInput) return;
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
        refreshAddLabel();
      });
      on(qs('[data-qty-inc]', root), 'click', function () {
        if (!qtyInput) return;
        qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
        refreshAddLabel();
      });

      if (form) {
        on(form, 'submit', function (e) {
          e.preventDefault();
          if (!idInput || !idInput.value || !addBtn || addBtn.disabled) return;
          addToCart(idInput.value, parseInt(qtyInput ? qtyInput.value : 1, 10) || 1, addBtn);
        });
      }

      var restockForm = qs('[data-restock-form]', root);
      if (restockForm) {
        on(restockForm, 'submit', function (e) {
          e.preventDefault();
          var idle = qs('[data-restock-idle]', root);
          var done = qs('[data-restock-done]', root);
          if (idle) idle.hidden = true;
          if (done) done.hidden = false;
        });
      }

      refreshAddLabel();
      updateOptionAvailability();
    });
  }

  /* ---------- PDP: size chart modal (demo) ---------- */
  function bindSizeChart() {
    qsa('[data-size-chart-open]').forEach(function (btn) {
      if (btn.__asBound) return;
      btn.__asBound = true;
      on(btn, 'click', function () {
        var modal = qs('[data-size-chart-modal]');
        if (modal) modal.removeAttribute('hidden');
      });
    });
    qsa('[data-size-chart-close]').forEach(function (btn) {
      if (btn.__asBound) return;
      btn.__asBound = true;
      on(btn, 'click', function () {
        var modal = qs('[data-size-chart-modal]');
        if (modal) modal.setAttribute('hidden', '');
      });
    });
  }

  /* ---------- Collection filter/sort (faceted filters auto-submit) ---------- */
  function bindCollectionFilters() {
    qsa('[data-collection-filter-form]').forEach(function (form) {
      qsa('[data-filter-input]', form).forEach(function (input) {
        if (input.__asBound) return;
        input.__asBound = true;
        on(input, 'change', function () { form.submit(); });
      });
      qsa('[data-sort-select]', form).forEach(function (select) {
        if (select.__asBound) return;
        select.__asBound = true;
        on(select, 'change', function () { form.submit(); });
      });
    });
  }

  /* ---------- init ---------- */
  function init() {
    bindHeader();
    bindCartDrawer();
    bindWishlistToggles();
    bindQuickAdd();
    bindCartLineControls();
    bindCoupon();
    syncCouponUI();
    bindCollectionFilters();
    bindMemberToggle();
    bindProductVariantPicker();
    bindSizeChart();
    syncWishlistBadges();
    document.addEventListener('archives:wishlist:change', syncWishlistBadges);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
