/* ============================================================
   ARCHIVES Studio — global theme behaviour
   Sprint 0: header (search toggle, mobile menu), cart drawer open/close,
   wishlist (localStorage) + header badges.
   Sprint 4: Ajax cart — add/change re-renders the cart drawer (and the
   cart page, when open) via the Section Rendering API.
   Sprint 5: Wishlist page (Products/Stylings tabs) — Products are fetched
   from /products/{handle}.js and rendered client-side; Stylings are
   defensive (Sprint 6 hasn't shipped real styling data yet).
   Sprint 9: Predictive search — debounced as-you-type fetch against
   /search/suggest.json rendered into the header's search-panel suggest
   dropdown.
   Follow-up (header redesign): hamburger is now always visible and opens a
   left-sliding nav drawer (block-driven) instead of toggling an inline
   mobile menu — see NavDrawer / bindNavDrawer below.
   Feature pack 1: PDP lightbox + SNS share + real wishlist toggle + real
   restock contact form, cart cross-sell, and coupon codes now redirect
   through Shopify's /discount/<code> URL (real discount, applied server-side)
   instead of a client-computed demo — see bindCoupon below.
   Feature pack 3: sale countdown (bindCountdown), first-visit newsletter
   popup (bindNewsletterPopup), and skeleton rows for the predictive search
   suggest panel while its fetch is in flight (renderSearchSkeleton).
   ============================================================ */
(function () {
  'use strict';

  var WISHLIST_NAMESPACES = {
    products: 'archives:wishlist:products',
    stylings: 'archives:wishlist:stylings'
  };
  var DRAWER_CLOSE_DELAY_MS = 480; /* matches --dur-drawer, so hidden is set only after the slide-out transition finishes */
  var CART_SECTION_ID = 'cart-drawer';
  var MAIN_CART_SECTION_ID = 'main-cart';

  /* ---------- small helpers ---------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  /* ---------- Wishlist store (localStorage, two namespaces) ----------
     "products" holds product handles (so the wishlist page can look each
     one up via /products/{handle}.js); "stylings" holds styling ids
     (Sprint 6 supplies the actual styling records). Every reader/writer
     takes the namespace explicitly so the two lists never collide. */
  var Wishlist = {
    key: function (ns) { return WISHLIST_NAMESPACES[ns] || WISHLIST_NAMESPACES.products; },
    read: function (ns) {
      try { return JSON.parse(localStorage.getItem(this.key(ns))) || []; }
      catch (e) { return []; }
    },
    write: function (ns, list) {
      localStorage.setItem(this.key(ns), JSON.stringify(list));
      document.dispatchEvent(new CustomEvent('archives:wishlist:change', { detail: { ns: ns, list: list } }));
    },
    has: function (ns, id) { return this.read(ns).indexOf(String(id)) !== -1; },
    toggle: function (ns, id) {
      id = String(id);
      var list = this.read(ns);
      var i = list.indexOf(id);
      if (i === -1) { list.push(id); } else { list.splice(i, 1); }
      this.write(ns, list);
      return i === -1;
    },
    remove: function (ns, id) {
      id = String(id);
      var list = this.read(ns);
      var i = list.indexOf(id);
      if (i === -1) return;
      list.splice(i, 1);
      this.write(ns, list);
    },
    count: function (ns) { return this.read(ns).length; },
    countAll: function () { return this.count('products') + this.count('stylings'); }
  };
  window.ArchivesWishlist = Wishlist;

  function syncWishlistBadges() {
    var count = Wishlist.countAll();
    qsa('[data-wishlist-badge]').forEach(function (badge) {
      badge.textContent = count;
      badge.hidden = count === 0;
    });
    qsa('[data-wishlist-toggle]').forEach(function (btn) {
      var ns = btn.getAttribute('data-wishlist-ns') || 'products';
      var active = Wishlist.has(ns, btn.getAttribute('data-wishlist-toggle'));
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
        var ns = btn.getAttribute('data-wishlist-ns') || 'products';
        Wishlist.toggle(ns, btn.getAttribute('data-wishlist-toggle'));
      });
    });
  }

  /* ---------- Header: search toggle ---------- */
  function bindHeader() {
    qsa('[data-search-toggle]').forEach(function (btn) {
      on(btn, 'click', function () {
        var panel = qs('[data-search-panel]');
        if (!panel) return;
        var open = panel.hasAttribute('hidden');
        if (open) {
          panel.removeAttribute('hidden');
          var input = qs('[data-search-input]', panel);
          if (input) input.focus();
        } else {
          panel.setAttribute('hidden', '');
          closeSearchSuggest(panel);
        }
      });
    });
  }

  /* ---------- Predictive search (header search panel suggest dropdown) ----------
     As-you-type suggestions via Shopify's Predictive Search API
     (/search/suggest.json). Typo/spelling-variation tolerance is handled
     server-side by that API, so this just debounces input, fetches, and
     renders whatever resource types come back (queries/products/collections/
     articles/pages). */
  var PREDICTIVE_SEARCH_DEBOUNCE_MS = 200;
  var PREDICTIVE_SEARCH_MIN_LENGTH = 2;
  var PREDICTIVE_SEARCH_LIMIT = 6;

  function closeSearchSuggest(panel) {
    var suggest = qs('[data-search-suggest]', panel);
    if (!suggest) return;
    suggest.setAttribute('hidden', '');
    suggest.innerHTML = '';
  }

  /* Skeleton rows shown the instant a fetch starts, so the panel never sits
     empty/blank while waiting on the network - replaced in-place by
     renderSearchSuggest() once the response lands. Sized to match the real
     .as-suggest-product markup (48x48 thumb + two text lines) so there's no
     layout shift when the skeleton is swapped for real results. */
  var SEARCH_SKELETON_ROWS = 3;
  function renderSearchSkeleton(suggest) {
    var row =
      '<div class="as-suggest-product as-skeleton-row">' +
        '<span class="as-suggest-thumb as-skeleton"></span>' +
        '<span class="as-suggest-info">' +
          '<span class="as-skeleton as-skeleton-line" style="width:75%;"></span>' +
          '<span class="as-skeleton as-skeleton-line" style="width:40%;"></span>' +
        '</span>' +
      '</div>';
    var rows = '';
    for (var i = 0; i < SEARCH_SKELETON_ROWS; i++) { rows += row; }
    suggest.innerHTML =
      '<div class="as-suggest-panel">' +
        '<p class="visually-hidden" role="status" aria-live="polite">' + escapeHtml(suggest.getAttribute('data-loading-text') || '検索中…') + '</p>' +
        '<div class="as-suggest-group as-suggest-products">' + rows + '</div>' +
      '</div>';
    suggest.removeAttribute('hidden');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderSearchSuggest(suggest, data) {
    var resources = (data && data.resources && data.resources.results) || {};
    var queries = resources.queries || [];
    var products = resources.products || [];
    var collections = resources.collections || [];
    var articles = resources.articles || [];
    var pages = resources.pages || [];
    var hasAny = queries.length || products.length || collections.length || articles.length || pages.length;

    if (!hasAny) {
      var emptyText = suggest.getAttribute('data-empty-text') || '一致する候補がありません';
      suggest.innerHTML = '<p class="as-suggest-status">' + escapeHtml(emptyText) + '</p>';
      suggest.removeAttribute('hidden');
      return;
    }

    function linkGroup(list) {
      var out = '';
      list.forEach(function (item) {
        out += '<a href="' + item.url + '" class="as-suggest-link as-clickable">' + escapeHtml(item.title) + '</a>';
      });
      return out;
    }

    var html = '<div class="as-suggest-panel">';

    if (queries.length) {
      html += '<div class="as-suggest-group">';
      queries.forEach(function (q) {
        /* styled_text is Shopify-rendered HTML (query text with the matched
           portion wrapped in <b>) - safe to inject, same as Dawn's
           predictive-search.js does. */
        html += '<button type="button" class="as-suggest-query" data-suggest-query="' + escapeHtml(q.text) + '">' + (q.styled_text || escapeHtml(q.text)) + '</button>';
      });
      html += '</div>';
    }

    if (products.length) {
      html += '<div class="as-suggest-group as-suggest-products">';
      products.forEach(function (p) {
        html += '<a href="' + p.url + '" class="as-suggest-product as-clickable">' +
          '<span class="as-suggest-thumb">' + (p.image ? '<img src="' + imageUrlWithWidth(p.image, 120) + '" alt="" width="60" height="60" loading="lazy">' : '') + '</span>' +
          '<span class="as-suggest-info"><span class="as-suggest-title">' + escapeHtml(p.title) + '</span><span class="as-suggest-price">' + formatMoney(Math.round(parseFloat(p.price) * 100)) + '</span></span>' +
          '</a>';
      });
      html += '</div>';
    }

    if (collections.length) {
      html += '<div class="as-suggest-group"><span class="as-suggest-eyebrow">' + escapeHtml(suggest.getAttribute('data-collections-label') || 'コレクション') + '</span>' + linkGroup(collections) + '</div>';
    }
    if (articles.length) {
      html += '<div class="as-suggest-group"><span class="as-suggest-eyebrow">' + escapeHtml(suggest.getAttribute('data-articles-label') || 'ジャーナル') + '</span>' + linkGroup(articles) + '</div>';
    }
    if (pages.length) {
      html += '<div class="as-suggest-group"><span class="as-suggest-eyebrow">' + escapeHtml(suggest.getAttribute('data-pages-label') || 'ページ') + '</span>' + linkGroup(pages) + '</div>';
    }

    html += '</div>';
    suggest.innerHTML = html;
    suggest.removeAttribute('hidden');
  }

  function bindPredictiveSearch() {
    var panel = qs('[data-search-panel]');
    if (!panel) return;
    var input = qs('[data-search-input]', panel);
    var suggest = qs('[data-search-suggest]', panel);
    if (!input || !suggest || input.__predictiveBound) return;
    input.__predictiveBound = true;

    var debounceTimer = null;
    var activeController = null;

    function fetchSuggestions(query) {
      if (activeController && activeController.abort) activeController.abort();
      activeController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      renderSearchSkeleton(suggest);

      var url = '/search/suggest.json?q=' + encodeURIComponent(query) +
        '&resources[type]=product,collection,article,page,query' +
        '&resources[limit]=' + PREDICTIVE_SEARCH_LIMIT +
        '&resources[options][unavailable_products]=last';

      fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: activeController ? activeController.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) { closeSearchSuggest(panel); return null; }
          return res.json();
        })
        .then(function (data) { if (data) renderSearchSuggest(suggest, data); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          closeSearchSuggest(panel);
        });
    }

    on(input, 'input', function () {
      var query = input.value.trim();
      window.clearTimeout(debounceTimer);
      if (query.length < PREDICTIVE_SEARCH_MIN_LENGTH) { closeSearchSuggest(panel); return; }
      debounceTimer = window.setTimeout(function () { fetchSuggestions(query); }, PREDICTIVE_SEARCH_DEBOUNCE_MS);
    });

    on(suggest, 'click', function (e) {
      var queryBtn = e.target.closest('[data-suggest-query]');
      if (!queryBtn) return;
      e.preventDefault();
      input.value = queryBtn.getAttribute('data-suggest-query');
      closeSearchSuggest(panel);
      var form = input.closest('form');
      if (form) form.submit();
    });

    on(document, 'keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (panel.hasAttribute('hidden')) return;
      if (!suggest.hasAttribute('hidden')) { closeSearchSuggest(panel); return; }
      panel.setAttribute('hidden', '');
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
      }, DRAWER_CLOSE_DELAY_MS);
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

  /* ---------- Nav drawer open/close (header redesign: hamburger -> left-sliding
     menu drawer, section-block driven). Same open/close mechanics as the cart
     drawer above (delegated clicks so it survives nothing special here, but
     kept consistent) — slides from the left instead of the right. ---------- */
  var NavDrawer = {
    el: function () { return qs('[data-nav-drawer]'); },
    scrim: function () { return qs('[data-nav-scrim]'); },
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
      }, DRAWER_CLOSE_DELAY_MS);
    }
  };

  function bindNavDrawer() {
    on(document, 'click', function (e) {
      if (e.target.closest('[data-nav-open]')) { e.preventDefault(); NavDrawer.open(); }
      else if (e.target.closest('[data-nav-close]')) { e.preventDefault(); NavDrawer.close(); }
      else if (e.target.closest('[data-nav-scrim]')) { NavDrawer.close(); }
    });
    on(document, 'keydown', function (e) { if (e.key === 'Escape') NavDrawer.close(); });
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
  }

  function requestedSectionIds() {
    var ids = [CART_SECTION_ID];
    if (mainCartContents()) ids.push(MAIN_CART_SECTION_ID);
    return ids;
  }

  /* Discount/subtotal/cross-sell numbers are all rendered server-side from
     the cart object (see sections/cart-drawer.liquid + main-cart.liquid), so
     swapping in the fresh section HTML is enough to keep them correct after
     every add/change - no client-side recompute needed. */
  function applySectionsResponse(sections) {
    if (!sections) return;
    if (sections[CART_SECTION_ID]) swapContents(cartDrawerContents(), sections[CART_SECTION_ID], '[data-cart-drawer-contents]');
    if (sections[MAIN_CART_SECTION_ID]) swapContents(mainCartContents(), sections[MAIN_CART_SECTION_ID], '[data-main-cart-contents]');
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
            throw new Error((err && err.description) || 'カートに追加できませんでした');
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
        window.alert(err.message || 'カートに追加できませんでした');
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
            throw new Error((err && err.description) || 'カートを更新できませんでした');
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
        .catch(function (err) { window.alert(err.message || 'カートを更新できませんでした'); })
        .then(function () { lineChangeBusy = false; });
    });
  }

  /* ---------- Coupon (real Shopify discount) ----------
     Shopify has no storefront API to validate/apply a discount code without
     a request round-trip, so this hands the code straight to Shopify's own
     /discount/<code> redemption URL - it applies the discount to the cart
     session server-side (or silently no-ops on an invalid code, which is
     Shopify's own behaviour) and lands back on /cart, where the discount
     row below is rendered from the real cart.total_discount. */
  function bindCoupon() {
    if (document.__couponBound) return;
    document.__couponBound = true;
    function apply() {
      var input = qs('[data-coupon-input]', cartDrawerContents());
      var code = input ? input.value.trim() : '';
      if (!code) return;
      window.location.href = '/discount/' + encodeURIComponent(code) + '?redirect=/cart';
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

  /* ---------- PDP: image lightbox (gallery zoom) ----------
     Event-delegated so it works regardless of how many gallery tiles the
     product has. Clicking a tile collects every [data-lightbox-open] inside
     its [data-lightbox-gallery] ancestor (DOM order == gallery order) so
     prev/next can step through the full set. */
  var LIGHTBOX_FADE_MS = 320; /* matches --dur-base, so [hidden] is only re-applied after the fade-out transition finishes */
  var Lightbox = {
    images: [],
    index: 0,
    trigger: null,
    el: function () { return qs('[data-lightbox]'); },
    imageEl: function () { var d = this.el(); return d ? qs('[data-lightbox-image]', d) : null; },
    render: function () {
      var img = this.imageEl();
      var current = this.images[this.index];
      if (!img || !current) return;
      img.src = current.src;
      img.alt = current.alt;
    },
    open: function (images, index, trigger) {
      var d = this.el();
      if (!d || !images.length) return;
      this.images = images;
      this.index = index;
      this.trigger = trigger || null;
      this.render();
      d.removeAttribute('hidden');
      requestAnimationFrame(function () { d.classList.add('is-open'); });
      document.body.classList.add('as-drawer-open');
      var closeBtn = qs('[data-lightbox-close]', d);
      if (closeBtn) closeBtn.focus();
    },
    close: function () {
      var d = this.el();
      if (!d || d.hasAttribute('hidden')) return;
      d.classList.remove('is-open');
      document.body.classList.remove('as-drawer-open');
      window.setTimeout(function () { d.setAttribute('hidden', ''); }, LIGHTBOX_FADE_MS);
      if (this.trigger && this.trigger.focus) this.trigger.focus();
      this.trigger = null;
    },
    next: function () { if (!this.images.length) return; this.index = (this.index + 1) % this.images.length; this.render(); },
    prev: function () { if (!this.images.length) return; this.index = (this.index - 1 + this.images.length) % this.images.length; this.render(); }
  };

  function bindLightbox() {
    if (document.__lightboxBound) return;
    document.__lightboxBound = true;

    on(document, 'click', function (e) {
      var opener = e.target.closest('[data-lightbox-open]');
      if (opener) {
        e.preventDefault();
        var gallery = opener.closest('[data-lightbox-gallery]');
        var openers = gallery ? qsa('[data-lightbox-open]', gallery) : [opener];
        var images = openers.map(function (node) {
          return { src: node.getAttribute('data-lightbox-src'), alt: node.getAttribute('data-lightbox-alt') || '' };
        });
        var index = openers.indexOf(opener);
        Lightbox.open(images, index === -1 ? 0 : index, opener);
        return;
      }
      if (e.target.closest('[data-lightbox-close]') || e.target.closest('[data-lightbox-scrim]')) { Lightbox.close(); return; }
      if (e.target.closest('[data-lightbox-next]')) { Lightbox.next(); return; }
      if (e.target.closest('[data-lightbox-prev]')) { Lightbox.prev(); return; }
    });

    on(document, 'keydown', function (e) {
      /* Gallery tiles are role="button" divs - Enter/Space should activate them like a real button. */
      var opener = e.target.closest && e.target.closest('[data-lightbox-open]');
      if (opener && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opener.click(); return; }

      var d = Lightbox.el();
      if (!d || d.hasAttribute('hidden')) return;
      if (e.key === 'Escape') { Lightbox.close(); }
      else if (e.key === 'ArrowRight') { Lightbox.next(); }
      else if (e.key === 'ArrowLeft') { Lightbox.prev(); }
    });
  }

  /* ---------- PDP: SNS share (X / Facebook / LINE / copy link) ---------- */
  function bindShare() {
    if (document.__shareBound) return;
    document.__shareBound = true;

    function openShareWindow(url) {
      window.open(url, '_blank', 'noopener,noreferrer,width=600,height=480');
    }

    on(document, 'click', function (e) {
      var xBtn = e.target.closest('[data-share-x]');
      var fbBtn = e.target.closest('[data-share-facebook]');
      var lineBtn = e.target.closest('[data-share-line]');
      var copyBtn = e.target.closest('[data-share-copy]');
      if (!xBtn && !fbBtn && !lineBtn && !copyBtn) return;
      e.preventDefault();

      if (xBtn) {
        var text = xBtn.getAttribute('data-share-text') || '';
        openShareWindow('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(xBtn.getAttribute('data-share-url')));
      } else if (fbBtn) {
        openShareWindow('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(fbBtn.getAttribute('data-share-url')));
      } else if (lineBtn) {
        openShareWindow('https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(lineBtn.getAttribute('data-share-url')));
      } else if (copyBtn) {
        var url = copyBtn.getAttribute('data-share-url');
        var status = qs('[data-share-status]', copyBtn.parentNode);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            if (status) status.textContent = status.getAttribute('data-copied-text') || '';
          });
        }
      }
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

  /* ---------- Wishlist page (Products/Stylings tabs) ---------- */
  function imageUrlWithWidth(url, width) {
    if (!url) return url;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + 'width=' + width;
  }

  function fetchProductJSON(handle) {
    return fetch('/products/' + encodeURIComponent(handle) + '.js', { headers: { 'Accept': 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('not found'); return res.json(); })
      /* A wishlisted handle can 404 (demo placeholder ids, or a product removed
         since it was wishlisted) - skip it instead of breaking the whole grid. */
      .catch(function () { return null; });
  }

  function buildWishlistProductCard(handle, product, template) {
    var node = template.content.firstElementChild.cloneNode(true);
    var variant = null;
    for (var i = 0; i < product.variants.length; i++) {
      if (product.variants[i].available) { variant = product.variants[i]; break; }
    }
    if (!variant) variant = product.variants[0];
    var available = !!(variant && variant.available);

    var link = qs('[data-field="url"]', node);
    var img = qs('[data-field="image"]', node);
    var title = qs('[data-field="title"]', node);
    var price = qs('[data-field="price"]', node);
    var addBtn = qs('[data-wish-add]', node);
    var removeBtn = qs('[data-wish-remove]', node);

    if (link) link.href = '/products/' + product.handle;
    if (img) {
      var src = product.featured_image || (product.images && product.images[0]) || '';
      img.src = imageUrlWithWidth(src, 800);
      img.alt = product.title;
    }
    if (title) title.textContent = product.title;
    if (price) price.textContent = formatMoney(product.price);
    if (addBtn) {
      addBtn.setAttribute('data-variant-id', variant ? variant.id : '');
      if (!available) {
        addBtn.disabled = true;
        addBtn.textContent = addBtn.getAttribute('data-label-soldout');
        addBtn.style.background = 'var(--color-n-300)';
        addBtn.style.cursor = 'not-allowed';
      }
    }
    if (removeBtn) removeBtn.setAttribute('data-handle', handle);
    return node;
  }

  function buildWishlistStylingCard(id, styling, template) {
    var node = template.content.firstElementChild.cloneNode(true);
    var links = qsa('[data-field="url"]', node);
    var img = qs('[data-field="image"]', node);
    var staff = qs('[data-field="staff"]', node);
    var measurements = qs('[data-field="measurements"]', node);
    var itemcount = qs('[data-field="itemcount"]', node);
    var removeBtn = qs('[data-wish-remove]', node);

    links.forEach(function (link) { link.href = styling.url || '#'; });
    if (img) { img.src = imageUrlWithWidth(styling.img, 800); img.alt = ''; }
    if (staff) staff.textContent = (styling.staffName || '') + ' — ' + (styling.staffRole || '');
    if (measurements) measurements.textContent = (styling.height || '') + ' / ' + (styling.weight || '');
    if (itemcount) itemcount.textContent = (styling.itemCount || 0) + ' ' + (itemcount.getAttribute('data-suffix') || '');
    if (removeBtn) removeBtn.setAttribute('data-handle', id);
    return node;
  }

  function bindWishlistPage() {
    var page = qs('[data-wishlist-page]');
    if (!page) return;

    var tabs = qsa('[data-wish-tab]', page);
    var panels = qsa('[data-wish-panel]', page);
    var productTemplate = qs('[data-wish-product-template]', page);
    var stylingTemplate = qs('[data-wish-styling-template]', page);

    function setActiveTab(name) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-wish-tab') === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-wish-panel') !== name;
      });
    }

    tabs.forEach(function (tab) {
      on(tab, 'click', function () { setActiveTab(tab.getAttribute('data-wish-tab')); });
    });

    function updateCounts() {
      qsa('[data-wish-count="products"]', page).forEach(function (el) { el.textContent = Wishlist.count('products'); });
      qsa('[data-wish-count="stylings"]', page).forEach(function (el) { el.textContent = Wishlist.count('stylings'); });
    }

    function renderProducts() {
      var handles = Wishlist.read('products');
      var grid = qs('[data-wish-grid="products"]', page);
      var empty = qs('[data-wish-empty="products"]', page);
      if (!handles.length) {
        grid.hidden = true;
        grid.innerHTML = '';
        empty.hidden = false;
        return;
      }
      Promise.all(handles.map(fetchProductJSON)).then(function (products) {
        grid.innerHTML = '';
        var rendered = 0;
        products.forEach(function (product, i) {
          if (!product) return;
          grid.appendChild(buildWishlistProductCard(handles[i], product, productTemplate));
          rendered++;
        });
        grid.hidden = rendered === 0;
        empty.hidden = rendered !== 0;
      });
    }

    function renderStylings() {
      var ids = Wishlist.read('stylings');
      var grid = qs('[data-wish-grid="stylings"]', page);
      var empty = qs('[data-wish-empty="stylings"]', page);
      /* window.ArchivesStylingDataset is an optional hook a future sprint
         (styling detail/metaobjects, Sprint 6) can populate with
         { [id]: { img, url, staffName, staffRole, height, weight, itemCount } }.
         Until then there's no data source, so this always falls through to
         the empty state - which is the correct behaviour today. */
      var dataset = window.ArchivesStylingDataset || {};
      grid.innerHTML = '';
      var rendered = 0;
      ids.forEach(function (id) {
        var styling = dataset[id];
        if (!styling) return;
        grid.appendChild(buildWishlistStylingCard(id, styling, stylingTemplate));
        rendered++;
      });
      grid.hidden = rendered === 0;
      empty.hidden = rendered !== 0;
    }

    function renderAll() {
      updateCounts();
      renderProducts();
      renderStylings();
    }

    on(page, 'click', function (e) {
      var removeBtn = e.target.closest('[data-wish-remove]');
      var addBtn = e.target.closest('[data-wish-add]');
      if (removeBtn) {
        e.preventDefault();
        var ns = removeBtn.getAttribute('data-wishlist-ns') || 'products';
        Wishlist.remove(ns, removeBtn.getAttribute('data-handle'));
      } else if (addBtn) {
        e.preventDefault();
        if (addBtn.disabled) return;
        var variantId = addBtn.getAttribute('data-variant-id');
        if (variantId) addToCart(variantId, 1, addBtn);
      }
    });

    document.addEventListener('archives:wishlist:change', renderAll);
    setActiveTab('products');
    renderAll();
  }

  /* ---------- Sale countdown (sections/sale-countdown.liquid) ----------
     Reads the ISO end date off data-countdown-to and ticks every second.
     Purely client-side (no server round trip needed once the page has
     loaded), so it keeps counting correctly even if the visitor's clock
     drifts slightly - only the initial target date matters. */
  function bindCountdown() {
    qsa('[data-countdown]').forEach(function (root) {
      if (root.__countdownBound) return;
      root.__countdownBound = true;

      var target = new Date(root.getAttribute('data-countdown-to')).getTime();
      if (!target || isNaN(target)) return;

      var timer = qs('[data-countdown-timer]', root);
      var endedEl = qs('[data-countdown-ended]', root);
      var daysEl = qs('[data-countdown-days]', root);
      var hoursEl = qs('[data-countdown-hours]', root);
      var minutesEl = qs('[data-countdown-minutes]', root);
      var secondsEl = qs('[data-countdown-seconds]', root);
      var intervalId = null;

      function pad(n) { return n < 10 ? '0' + n : String(n); }

      function tick() {
        var diff = target - Date.now();
        if (diff <= 0) {
          if (timer) timer.hidden = true;
          if (endedEl) endedEl.hidden = false;
          if (intervalId) window.clearInterval(intervalId);
          return;
        }
        var totalSeconds = Math.floor(diff / 1000);
        var days = Math.floor(totalSeconds / 86400);
        var hours = Math.floor((totalSeconds % 86400) / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        if (daysEl) daysEl.textContent = pad(days);
        if (hoursEl) hoursEl.textContent = pad(hours);
        if (minutesEl) minutesEl.textContent = pad(minutes);
        if (secondsEl) secondsEl.textContent = pad(seconds);
      }

      tick();
      intervalId = window.setInterval(tick, 1000);
    });
  }

  /* ---------- Newsletter / first-order-discount popup (snippets/newsletter-popup.liquid) ----------
     Shown once, a few seconds after first load, then suppressed forever via
     a localStorage flag - set as soon as the visitor dismisses it OR submits
     the form (no need to wait for the redirect back). prefers-reduced-motion
     is handled in CSS (the .as-popup-scrim/.as-popup transitions are
     disabled there), so no branching is needed here. */
  var NEWSLETTER_POPUP_STORAGE_KEY = 'archives:newsletter-popup:dismissed';

  function bindNewsletterPopup() {
    var popup = qs('[data-newsletter-popup]');
    if (!popup || popup.__asBound) return;
    popup.__asBound = true;

    function markDismissed() {
      try { window.localStorage.setItem(NEWSLETTER_POPUP_STORAGE_KEY, '1'); } catch (e) { /* private mode / storage disabled */ }
    }

    function close() {
      popup.classList.remove('is-open');
      document.body.classList.remove('as-drawer-open');
      window.setTimeout(function () { popup.setAttribute('hidden', ''); }, DRAWER_CLOSE_DELAY_MS);
    }

    function open() {
      popup.removeAttribute('hidden');
      requestAnimationFrame(function () { popup.classList.add('is-open'); });
      document.body.classList.add('as-drawer-open');
    }

    on(popup, 'click', function (e) {
      if (e.target === popup || e.target.closest('[data-popup-close]')) {
        markDismissed();
        close();
      }
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && popup.classList.contains('is-open')) { markDismissed(); close(); }
    });

    var form = qs('form', popup);
    if (form) on(form, 'submit', markDismissed);

    /* A server-rendered success state means the form was just submitted
       (page reloaded after redirect) - don't pop it open again. */
    if (qs('[data-popup-success]', popup)) { markDismissed(); return; }

    var dismissed = false;
    try { dismissed = window.localStorage.getItem(NEWSLETTER_POPUP_STORAGE_KEY) === '1'; } catch (e) { /* private mode / storage disabled */ }
    if (dismissed) return;

    var delaySeconds = parseFloat(popup.getAttribute('data-popup-delay')) || 5;
    window.setTimeout(open, delaySeconds * 1000);
  }

  /* ---------- init ---------- */
  function init() {
    bindHeader();
    bindPredictiveSearch();
    bindCartDrawer();
    bindNavDrawer();
    bindWishlistToggles();
    bindQuickAdd();
    bindCartLineControls();
    bindCoupon();
    bindCollectionFilters();
    bindWishlistPage();
    bindMemberToggle();
    bindProductVariantPicker();
    bindSizeChart();
    bindLightbox();
    bindShare();
    bindCountdown();
    bindNewsletterPopup();
    syncWishlistBadges();
    document.addEventListener('archives:wishlist:change', syncWishlistBadges);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
