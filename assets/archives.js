/* ============================================================
   ARCHIVES Studio — global theme behaviour
   Sprint 0 scope: header (search toggle, mobile menu), cart drawer
   open/close, wishlist (localStorage) + header badges.
   Ajax cart line-item logic is layered on in later sprints.
   ============================================================ */
(function () {
  'use strict';

  var WISHLIST_KEY = 'archives:wishlist';

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
    qsa('[data-cart-open]').forEach(function (btn) { on(btn, 'click', function (e) { e.preventDefault(); CartDrawer.open(); }); });
    qsa('[data-cart-close]').forEach(function (btn) { on(btn, 'click', function (e) { e.preventDefault(); CartDrawer.close(); }); });
    on(CartDrawer.scrim(), 'click', function () { CartDrawer.close(); });
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
        var label = btn.textContent;
        btn.disabled = true;
        fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ id: variantId, quantity: 1 })
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (err) {
                throw new Error((err && err.description) || 'Could not add to cart');
              });
            }
            return res.json();
          })
          .then(function () {
            updateCartBadge();
            CartDrawer.open();
          })
          .catch(function (err) {
            window.alert(err.message || 'Could not add to cart');
          })
          .then(function () {
            btn.disabled = false;
            btn.textContent = label;
          });
      });
    });
  }

  /* ---------- init ---------- */
  function init() {
    bindHeader();
    bindCartDrawer();
    bindWishlistToggles();
    bindQuickAdd();
    syncWishlistBadges();
    document.addEventListener('archives:wishlist:change', syncWishlistBadges);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
