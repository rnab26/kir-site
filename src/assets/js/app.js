/* KIR · Wall Studio — interactions (no dependencies). */
(function () {
  'use strict';
  var K = window.KIR || { t: {}, base: '', prefix: '' };
  var T = K.t || {};
  var doc = document.documentElement;
  doc.classList.add('js');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(pointer: fine)').matches;
  var rtl = doc.dir === 'rtl';
  var nf = new Intl.NumberFormat(K.lang === 'fr' ? 'fr-FR' : 'he-IL');
  var money = function (n) { return nf.format(n) + ' ₪'; };
  var productUrl = function (id, fam) { return K.base + '/' + K.prefix + 'p/' + (fam || id) + '/' + (fam && fam !== id ? '?v=' + id : ''); };

  /* Header: scrolled state + mobile menu */
  var header = $('[data-header]');
  var onScroll = function () { if (header) header.classList.toggle('scrolled', window.scrollY > 40); };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  var menuBtn = $('[data-menu]'), nav = $('#site-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = menuBtn.getAttribute('aria-expanded') !== 'true';
      menuBtn.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open);
    });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') { menuBtn.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); } });
  }
  /* Catalog dropdown (sections): hover/focus on desktop, button toggle everywhere */
  $$('[data-drop]').forEach(function (b) {
    var item = b.parentNode;
    var set = function (open) { b.setAttribute('aria-expanded', String(open)); item.classList.toggle('open', open); };
    b.addEventListener('click', function (e) { e.stopPropagation(); set(b.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('click', function (e) { if (!item.contains(e.target)) set(false); });
    item.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); b.focus(); } });
  });

  /* Toast (optional action link) */
  var toastEl = $('[data-toast]'), toastTimer;
  function toast(msg, linkText, href) {
    if (!toastEl) return;
    toastEl.innerHTML = '';
    toastEl.appendChild(document.createTextNode(msg));
    if (linkText && href) { var a = document.createElement('a'); a.href = href; a.textContent = linkText; a.className = 'toast-link'; toastEl.appendChild(a); }
    toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, linkText ? 4200 : 2200);
  }
  /* Reveal on scroll */
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else { $$('.reveal').forEach(function (el) { el.classList.add('in'); }); }

  /* Hero: raking light follows the pointer; drifts by itself when idle */
  var hero = $('[data-hero]');
  if (hero) {
    var tx = 0.62, ty = 0.38, cx = tx, cy = ty, last = 0, visible = true, raf = 0, t0 = performance.now();
    var setVars = function () {
      hero.style.setProperty('--mx', (cx * 100).toFixed(2) + '%');
      hero.style.setProperty('--my', (cy * 100).toFixed(2) + '%');
      hero.style.setProperty('--lx', cx.toFixed(3));
      hero.style.setProperty('--px', ((cx - 0.5) * 2).toFixed(3));
      hero.style.setProperty('--py', ((cy - 0.5) * 2).toFixed(3));
    };
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width; ty = (e.clientY - r.top) / r.height; last = performance.now();
    });
    var loop = function (now) {
      if (now - last > 2500) {
        var s = (now - t0) / 1000;
        tx = 0.5 + Math.sin(s * 0.35) * 0.32; ty = 0.42 + Math.sin(s * 0.53 + 1) * 0.18;
      }
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08; setVars();
      raf = visible ? requestAnimationFrame(loop) : 0;
    };
    if (reduce) { setVars(); } else {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }).observe(hero);
      }
      raf = requestAnimationFrame(loop);
    }
  }

  /* Material tiles: tilt + sheen */
  if (fine && !reduce) {
    $$('[data-tilt] .mat').forEach(function (m) {
      m.addEventListener('pointermove', function (e) {
        var r = m.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        m.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(2) + 'deg');
        m.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(2) + 'deg');
        m.style.setProperty('--sx', (x * 100).toFixed(1) + '%'); m.style.setProperty('--sy', (y * 100).toFixed(1) + '%');
      });
      m.addEventListener('pointerleave', function () { m.style.setProperty('--rx', '0deg'); m.style.setProperty('--ry', '0deg'); });
    });
  }

  /* Studio: room in perspective */
  $$('.studio').forEach(function (sec) {
    var room = $('[data-room]', sec); if (!room) return;
    var fit = function () { room.style.setProperty('--s', (room.clientWidth / 1000).toFixed(4)); };
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(room); else window.addEventListener('resize', fit);
    fit();
    var sw = $$('.swatch', sec), flutes = $('[data-flutes]', sec);
    var pick = function (b) {
      sw.forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      room.style.setProperty('--tex', 'url(' + b.getAttribute('data-tex') + ')');
      var f = b.getAttribute('data-flute') === '1';
      if (flutes) flutes.checked = f;
      room.setAttribute('data-flute', f ? '1' : '0');
    };
    sw.forEach(function (b, i) {
      b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
      b.addEventListener('click', function () { pick(b); });
      b.addEventListener('keydown', function (e) {
        var d = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (!d) return; e.preventDefault();
        var n = sw[(i + d + sw.length) % sw.length]; pick(n); n.focus();
      });
    });
    if (flutes) flutes.addEventListener('change', function () { room.setAttribute('data-flute', flutes.checked ? '1' : '0'); });
    $$('[data-mode]', sec).forEach(function (b) {
      if (b === room) return;
      b.addEventListener('click', function () {
        $$('button[data-mode]', sec).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        room.setAttribute('data-mode', b.getAttribute('data-mode'));
      });
    });
    $$('button[data-light]', sec).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('button[data-light]', sec).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        room.setAttribute('data-light', b.getAttribute('data-light'));
      });
    });
    if (fine && !reduce) {
      room.addEventListener('pointermove', function (e) {
        var r = room.getBoundingClientRect();
        room.style.setProperty('--rx2', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        room.style.setProperty('--ry2', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }
  });

  /* Quantity calculator (+ add the computed quantity to the cart) */
  $$('[data-calc]').forEach(function (f) {
    var ww = $('[data-ww]', f), wh = $('[data-wh]', f), sel = $('[data-model]', f);
    var outN = $('[data-n]', f), outC = $('[data-cost]', f), note = $('[data-note]', f), addBtn = $('[data-calc-add]', f);
    var lastN = 0;
    var run = function () {
      var o = sel && sel.options[sel.selectedIndex]; if (!o) return;
      var w = parseFloat(o.getAttribute('data-w')), l = parseFloat(o.getAttribute('data-l')) * 100, p = parseFloat(o.getAttribute('data-p'));
      var W = parseFloat(ww.value) || 0, H = parseFloat(wh.value) || 0;
      if (!w || !l || W <= 0 || H <= 0) { outN.textContent = '-'; outC.textContent = '-'; lastN = 0; if (addBtn) addBtn.hidden = true; return; }
      var cols = Math.ceil(W / w), rows = Math.ceil(H / l), n = Math.ceil(cols * rows * 1.1);
      lastN = n;
      outN.textContent = nf.format(n);
      outC.textContent = isNaN(p) ? (T.onRequest || '') : money(n * p);
      var msg = T.waste || '';
      if (rows > 1) msg += ' · ' + (T.tooTall || '');
      if (isNaN(p)) msg += ' · ' + (T.noPrice || '');
      note.textContent = msg;
      if (addBtn) { addBtn.hidden = false; addBtn.textContent = (addBtn.getAttribute('data-tpl') || '').replace('{n}', nf.format(n)); }
    };
    [ww, wh, sel].forEach(function (el) { el && el.addEventListener('input', run); });
    if (addBtn) addBtn.addEventListener('click', function () { if (lastN > 0 && sel.value) cartAdd(sel.value, lastN); });
    run();
  });
  /* Catalog filters */
  var bar = $('[data-filters]');
  if (bar) {
    var grid = $('[data-grid]');
    var cards = $$('.card', grid);
    var q = $('[data-q]', bar), sort = $('[data-sort]', bar), count = $('[data-n]', bar), clear = $('[data-clear]', bar), empty = $('[data-empty]', bar);
    var active = { c: [], s: [], look: [], color: [] };
    var params = new URLSearchParams(location.search);
    ['c', 's', 'look', 'color'].forEach(function (g) { var v = params.get(g); if (v) active[g] = v.split(','); });
    if (params.get('q') && q) q.value = params.get('q');
    $$('.chip', bar).forEach(function (ch) {
      var g = ch.getAttribute('data-f'), v = ch.getAttribute('data-v');
      if (active[g].indexOf(v) > -1) ch.setAttribute('aria-pressed', 'true');
      ch.addEventListener('click', function () {
        var i = active[g].indexOf(v);
        if (i > -1) active[g].splice(i, 1); else active[g].push(v);
        ch.setAttribute('aria-pressed', String(i < 0)); apply(true);
      });
    });
    var norm = function (s) { return (s || '').toLowerCase().replace(/[֑-ׇ]/g, '').trim(); };
    var apply = function (push) {
      var term = norm(q && q.value), n = 0;
      cards.forEach(function (c) {
        var ok = (!active.c.length || active.c.indexOf(c.getAttribute('data-c')) > -1) && (!active.s.length || active.s.indexOf(c.getAttribute('data-s')) > -1)
          && (!active.look.length || active.look.some(function (v) { return (' ' + c.getAttribute('data-looks') + ' ').indexOf(' ' + v + ' ') > -1; }))
          && (!active.color.length || active.color.some(function (v) { return (' ' + c.getAttribute('data-colors') + ' ').indexOf(' ' + v + ' ') > -1; }))
          && (!term || term.split(/\s+/).every(function (w) { return c.getAttribute('data-q').indexOf(w) > -1; }));
        c.hidden = !ok; if (ok) n += parseInt(c.getAttribute('data-k'), 10) || 1;
      });
      if (count) count.textContent = nf.format(n);
      var any = active.c.length || active.s.length || active.look.length || active.color.length || term;
      if (clear) clear.hidden = !any;
      if (empty) empty.hidden = n > 0;
      if (push && history.replaceState) {
        var p = new URLSearchParams();
        ['c', 's', 'look', 'color'].forEach(function (g) { if (active[g].length) p.set(g, active[g].join(',')); });
        if (term) p.set('q', q.value.trim());
        var s = p.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
      }
    };
    var doSort = function () {
      var m = sort && sort.value;
      var arr = cards.slice().sort(function (a, b) {
        if (!m) return a.getAttribute('data-i') - b.getAttribute('data-i');
        var pa = parseFloat(a.getAttribute('data-p')), pb = parseFloat(b.getAttribute('data-p'));
        if (isNaN(pa)) return 1; if (isNaN(pb)) return -1;
        return m === 'asc' ? pa - pb : pb - pa;
      });
      arr.forEach(function (c) { grid.appendChild(c); });
    };
    if (q) q.addEventListener('input', function () { apply(true); });
    if (sort) sort.addEventListener('change', doSort);
    if (clear) clear.addEventListener('click', function () {
      active = { c: [], s: [], look: [], color: [] }; if (q) q.value = '';
      $$('.chip', bar).forEach(function (c) { c.setAttribute('aria-pressed', 'false'); }); apply(true);
    });
    apply(false);
  }

  /* ---------- Shop: cart, checkout, orders (stored in this browser) ---------- */
  var KEY = 'kir-list-v1', OKEY = 'kir-orders-v1';
  var load = function (k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  var save = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var cart = load(KEY, {});
  var pageUrl = function (p) { return K.base + '/' + K.prefix + p; };
  var countEls = $$('[data-count]');
  function cartCount() { var n = 0; Object.keys(cart).forEach(function (k) { n += cart[k] || 0; }); return n; }
  function refresh() {
    var n = cartCount();
    countEls.forEach(function (c) { c.textContent = n; c.hidden = n === 0; });
    $$('[data-add]').forEach(function (b) {
      var on = !!cart[b.getAttribute('data-add')];
      b.classList.toggle('on', on);
      if (b.hasAttribute('data-label')) b.textContent = on ? T.added : T.add;
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function bump() { var lb = $('.list-btn'); if (lb) { lb.classList.remove('bump'); void lb.offsetWidth; lb.classList.add('bump'); } }
  function cartAdd(id, qty) {
    cart[id] = (cart[id] || 0) + (qty || 1); save(KEY, cart); refresh(); bump(); renderCart();
    toast(T.addedToCart || T.added, T.viewCart, pageUrl('cart/'));
  }
  window.KIRcartAdd = cartAdd;
  document.addEventListener('click', function (e) {
    var step = e.target.closest && e.target.closest('[data-step]');
    if (step) { var inp = step.parentNode.querySelector('[data-qty-in]'); if (inp) inp.value = Math.max(1, (parseInt(inp.value, 10) || 1) + parseInt(step.getAttribute('data-step'), 10)); return; }
    var b = e.target.closest && e.target.closest('[data-add]'); if (!b) return;
    e.preventDefault();
    var id = b.getAttribute('data-add');
    if (b.hasAttribute('data-cart-add')) {
      var q = b.parentNode.querySelector('[data-qty-in]');
      cartAdd(id, Math.max(1, parseInt(q && q.value, 10) || 1));
    } else if (cart[id]) { delete cart[id]; save(KEY, cart); refresh(); renderCart(); }
    else { cartAdd(id, 1); }
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) { cart = load(KEY, {}); refresh(); renderCart(); } });
  refresh();

  var DATA = null, LIVE = null;
  function getData(cb) {
    if (DATA) return cb(DATA);
    fetch(K.data).then(function (r) { return r.json(); }).then(function (d) {
      DATA = {}; d.forEach(function (p) { DATA[p.id] = p; });
      applyLiveToData(); cb(DATA);
    }).catch(function () { cb({}); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nameOf(p) { return p[K.lang] || p.he; }
  function prodUrl(p) { return productUrl(p.id, p.f); }
  function lines(D) {
    var out = [], total = 0, quote = 0, n = 0;
    Object.keys(cart).forEach(function (id) {
      var p = D[id]; if (!p || p.hide) return;
      var q = cart[id] || 1; n += q;
      if (p.p != null) total += p.p * q; else quote++;
      out.push({ p: p, q: q });
    });
    return { list: out, total: total, quote: quote, n: n };
  }
  function summaryHtml(S, withBtn) {
    var h = '<h2>' + esc(T.cart) + '</h2><dl class="sum"><div><dt>' + esc(T.items) + '</dt><dd>' + nf.format(S.n) + '</dd></div>' +
      '<div class="sum-total"><dt>' + esc(T.total) + '</dt><dd>' + money(S.total) + '</dd></div></dl>';
    if (S.quote) h += '<p class="note">+ ' + S.quote + ' ' + esc(T.quoteItems) + '</p>';
    if (withBtn) h += '<a class="btn btn-dark btn-big" href="' + pageUrl('checkout/') + '">' + esc(T.toCheckout) + '</a><a class="link" href="' + pageUrl('catalog/') + '">' + esc(T.continueShopping) + '</a>';
    h += '<p class="note">' + esc(T.payText) + '</p>';
    return h;
  }
  var cartBox = $('[data-cart]'), cartSum = $('[data-cart-summary]');
  function renderCart() {
    if (!cartBox) return;
    getData(function (D) {
      var S = lines(D);
      if (!S.list.length) {
        cartBox.innerHTML = '<p class="lead">' + esc(T.listEmpty) + '</p><p><a class="btn" href="' + pageUrl('catalog/') + '">' + esc(T.viewAll) + '</a></p>';
        if (cartSum) cartSum.innerHTML = ''; return;
      }
      cartBox.innerHTML = '<ul class="qlist">' + S.list.map(function (x) {
        var p = x.p;
        return '<li class="qitem"><img src="' + K.base + '/assets/img/thumb/' + p.img + '.jpg" alt="" width="64" height="80" loading="lazy">' +
          '<div><a href="' + prodUrl(p) + '">' + esc(nameOf(p)) + '</a><small><bdi>' + esc(p.r) + '</bdi>' + (p.s ? ' · <bdi>' + esc(p.s) + '</bdi>' : '') + ' · ' + (p.p != null ? money(p.p) + ' ' + esc(T.unit) : esc(T.onRequest)) + (p.oos ? ' · <em class="oos">' + esc(T.outStock) + '</em>' : '') + '</small></div>' +
          '<label class="qty"><span class="sr">' + esc(T.qty) + '</span><input type="number" min="1" max="9999" value="' + x.q + '" data-qty="' + p.id + '"></label>' +
          '<strong class="ltot">' + (p.p != null ? money(p.p * x.q) : '—') + '</strong>' +
          '<button class="qremove" type="button" data-rm="' + p.id + '" aria-label="' + esc(T.remove) + '">✕</button></li>';
      }).join('') + '</ul>';
      if (cartSum) cartSum.innerHTML = summaryHtml(S, true);
      $$('[data-qty]', cartBox).forEach(function (inp) {
        inp.addEventListener('change', function () { cart[inp.getAttribute('data-qty')] = Math.max(1, parseInt(inp.value, 10) || 1); save(KEY, cart); refresh(); renderCart(); });
      });
      $$('[data-rm]', cartBox).forEach(function (b) { b.addEventListener('click', function () { delete cart[b.getAttribute('data-rm')]; save(KEY, cart); refresh(); renderCart(); }); });
    });
  }
  renderCart();

  function orderText(o, D) {
    var L = [T.listIntro, ''];
    L.push((T.orderNo || '#') + ': ' + o.id);
    o.items.forEach(function (x) { L.push('• ' + x.n + ' | ' + (T.sku || '') + ' ' + x.r + (x.s ? ' | ' + x.s : '') + ' | ' + (T.qty || '') + ': ' + x.q + (x.p != null ? ' | ' + money(x.p * x.q) : ' | ' + T.onRequest)); });
    L.push('');
    L.push((T.total || '') + ': ' + money(o.total) + (o.quote ? ' (+' + o.quote + ' ' + (T.quoteItems || '') + ')' : ''));
    L.push('');
    L.push((T.fName || '') + ': ' + o.c.name);
    L.push((T.fPhone || '') + ': ' + o.c.phone);
    if (o.c.email) L.push('Email: ' + o.c.email);
    L.push((T.fDelivery || '') + ': ' + (o.c.delivery === 'delivery' ? T.delivery : T.pickup));
    if (o.c.city || o.c.address) L.push((T.fCity || '') + ': ' + [o.c.city, o.c.address].filter(Boolean).join(', '));
    L.push((T.fContact || '') + ' ' + (o.c.contact === 'phone' ? T.byPhone : T.byWa));
    if (o.c.notes) L.push((T.fNotes || '') + ': ' + o.c.notes);
    return L.join('\n');
  }
  function waUrl(text) { return 'https://wa.me/' + K.wa + '?text=' + encodeURIComponent(text); }

  var co = $('[data-checkout]'), coSum = $('[data-checkout-summary]');
  if (co) {
    getData(function (D) {
      var S = lines(D);
      if (coSum) coSum.innerHTML = S.list.length ? summaryHtml(S, false) + '<ul class="mini">' + S.list.map(function (x) { return '<li><span>' + esc(nameOf(x.p)) + ' × ' + x.q + '</span><b>' + (x.p.p != null ? money(x.p.p * x.q) : '—') + '</b></li>'; }).join('') + '</ul>' : '<p>' + esc(T.listEmpty) + '</p>';
    });
    var addr = $('[data-addr]', co);
    $$('input[name=delivery]', co).forEach(function (r) { r.addEventListener('change', function () { var d = co.delivery.value === 'delivery'; addr.hidden = !d; co.address.required = d; co.city.required = d; }); });
    try { var prev = JSON.parse(localStorage.getItem('kir-customer') || 'null'); if (prev) { ['name', 'phone', 'email', 'city', 'address'].forEach(function (k) { if (prev[k] && co[k]) co[k].value = prev[k]; }); } } catch (e) {}
    co.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      var setErr = function (k, m) { var el = $('[data-err="' + k + '"]', co); if (el) el.textContent = m || ''; if (m) ok = false; };
      ['name', 'phone', 'city', 'consent', 'address'].forEach(function (k) { setErr(k, ''); });
      if (!co.name.value.trim()) setErr('name', T.required);
      var ph = co.phone.value.replace(/[^\d+]/g, '');
      if (!ph) setErr('phone', T.required); else if (ph.replace(/\D/g, '').length < 9) setErr('phone', T.badPhone);
      if (co.delivery.value === 'delivery' && !co.city.value.trim()) setErr('city', T.required);
      if (co.delivery.value === 'delivery' && !co.address.value.trim()) setErr('address', T.required);
      if (!co.consent.checked) setErr('consent', T.required);
      if (!ok) { var first = co.querySelector('.err:not(:empty)'); if (first) first.parentNode.querySelector('input,textarea').focus(); return; }
      getData(function (D) {
        var S = lines(D); if (!S.list.length) { toast(T.listEmpty); return; }
        var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var o = {
          id: 'HI-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          date: d.toISOString(), lang: K.lang, total: S.total, quote: S.quote,
          items: S.list.map(function (x) { return { id: x.p.id, f: x.p.f, n: nameOf(x.p), r: x.p.r, s: x.p.s, q: x.q, p: x.p.p, img: x.p.img }; }),
          c: { name: co.name.value.trim(), phone: co.phone.value.trim(), email: co.email.value.trim(), city: co.city.value.trim(), address: co.address.value.trim(), delivery: co.delivery.value, contact: co.contact.value, notes: co.notes.value.trim() }
        };
        var orders = load(OKEY, []); orders.unshift(o); save(OKEY, orders.slice(0, 30));
        try { localStorage.setItem('kir-customer', JSON.stringify({ name: o.c.name, phone: o.c.phone, email: o.c.email, city: o.c.city, address: o.c.address })); } catch (e2) {}
        cart = {}; save(KEY, cart); refresh();
        var url = waUrl(orderText(o, D));
        window.open(url, '_blank', 'noopener');
        location.href = pageUrl('order/') + '?id=' + encodeURIComponent(o.id);
      });
    });
  }

  function orderCard(o, full) {
    var h = '<article class="order-card"><header><strong>' + esc(T.orderNo) + ' <bdi>' + esc(o.id) + '</bdi></strong><span>' + new Date(o.date).toLocaleString(K.lang === 'he' ? 'he-IL' : K.lang === 'fr' ? 'fr-FR' : 'en-GB') + '</span></header>';
    h += '<ul class="mini">' + o.items.map(function (x) { return '<li><a href="' + productUrl(x.id, x.f) + '">' + esc(x.n) + '</a> × ' + x.q + '<b>' + (x.p != null ? money(x.p * x.q) : '—') + '</b></li>'; }).join('') + '</ul>';
    h += '<p class="sum-total"><span>' + esc(T.total) + '</span><b>' + money(o.total) + '</b></p><p class="badge-status">' + esc(T.statusSent) + '</p>';
    if (full) h += '<div class="qactions"><a class="btn btn-wa" target="_blank" rel="noopener" href="' + waUrl(orderText(o)) + '">' + esc(T.resend) + '</a><button class="btn" type="button" onclick="window.print()">' + esc(T.print) + '</button></div>';
    return h + '</article>';
  }
  var ob = $('[data-order]');
  if (ob) {
    var oid = new URLSearchParams(location.search).get('id'); var all = load(OKEY, []);
    var o = all.filter(function (x) { return x.id === oid; })[0] || all[0];
    ob.innerHTML = o ? '<div class="thanks"><p class="kicker">✓</p><h1>' + esc(T.orderThanks) + '</h1><p class="lead">' + esc(T.orderNext) + '</p></div>' + orderCard(o, true) + '<p><a class="link" href="' + pageUrl('orders/') + '">' + esc(T.orders) + '</a></p>' : '<p class="lead">' + esc(T.noOrders) + '</p>';
  }
  var obl = $('[data-orders]');
  if (obl) { var list = load(OKEY, []); obl.innerHTML = list.length ? list.map(function (x) { return orderCard(x, true); }).join('') : '<p class="lead">' + esc(T.noOrders) + '</p><p><a class="btn" href="' + pageUrl('catalog/') + '">' + esc(T.viewAll) + '</a></p>'; }
  /* Product page: variant picker + gallery tabs */
  var prod = $('[data-product]');
  if (prod) {
    var vopts = $$('.vopt', prod);
    var showVariant = function (id, push) {
      var ok = false;
      $$('[data-vg]', prod).forEach(function (g) { var on = g.getAttribute('data-vg') === id; g.hidden = !on; if (on) ok = true; });
      if (!ok) return;
      $$('[data-vb]', prod).forEach(function (b) { b.hidden = b.getAttribute('data-vb') !== id; });
      vopts.forEach(function (o) { o.setAttribute('aria-checked', String(o.getAttribute('data-v') === id)); });
      if (push && history.replaceState) { var p = new URLSearchParams(location.search); p.set('v', id); history.replaceState(null, '', location.pathname + '?' + p.toString()); }
      syncBuybar();
    };
    /* Sticky buy bar: appears once the main Add button has scrolled out of view */
    var bb = $('[data-buybar]', prod), bbPrice = bb && $('[data-bb-price]', bb);
    var curAdd = function () { return $('[data-vb]:not([hidden]) [data-cart-add]', prod); };
    var syncBuybar = function () {
      if (!bb) return;
      var vb = $('[data-vb]:not([hidden])', prod), pr = vb && $('.pd-price .price', vb), acts = vb && $('.pd-actions', vb);
      var ph = pr ? pr.innerHTML : ''; if (bbPrice.innerHTML !== ph) bbPrice.innerHTML = ph;
      var show = !!acts && !!curAdd() && acts.getBoundingClientRect().bottom < 0;
      if (bb.hidden === show) { bb.hidden = !show; document.body.classList.toggle('has-buybar', show); }
    };
    window.KIRsyncBuybar = syncBuybar;
    if (bb) {
      window.addEventListener('scroll', syncBuybar, { passive: true });
      window.addEventListener('resize', syncBuybar);
      $('[data-bb-add]', bb).addEventListener('click', function () { var a = curAdd(); if (a) a.click(); });
    }
    vopts.forEach(function (o, i) {
      o.addEventListener('click', function () { showVariant(o.getAttribute('data-v'), true); });
      o.addEventListener('keydown', function (e) {
        var d = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key]; if (!d) return;
        e.preventDefault(); var n = vopts[(i + d + vopts.length) % vopts.length]; n.focus(); showVariant(n.getAttribute('data-v'), true);
      });
    });
    var qv = new URLSearchParams(location.search).get('v'); if (qv) showVariant(qv, false);
    $$('.gallery', prod).forEach(function (g) {
      $$('[data-show]', g).forEach(function (t) {
        t.addEventListener('click', function () {
          var v = t.getAttribute('data-show');
          $$('[data-view]', g).forEach(function (f) { f.hidden = f.getAttribute('data-view') !== v; });
          $$('[data-show]', g).forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        });
      });
    });
  }
  /* Plate renders follow the pointer in 3D */
  if (fine && !reduce) $$('[data-tilt3d]').forEach(function (el) {
    var box = el.parentNode;
    box.addEventListener('pointermove', function (e) {
      var r = box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = 'rotateY(' + (x * 9).toFixed(2) + 'deg) rotateX(' + (-y * 5).toFixed(2) + 'deg) scale(1.015)';
    });
    box.addEventListener('pointerleave', function () { el.style.transform = ''; });
  });

  /* Product image zoom */
  $$('[data-zoom]').forEach(function (z) {
    if (!fine) return;
    z.addEventListener('pointerenter', function () { z.classList.add('zooming'); });
    z.addEventListener('pointerleave', function () { z.classList.remove('zooming'); });
    z.addEventListener('pointermove', function (e) {
      var r = z.getBoundingClientRect();
      z.style.setProperty('--zx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      z.style.setProperty('--zy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
  });
  /* ---------- Live data: prices, stock and removals read straight from the published Google Sheet ---------- */
  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    var head = rows.shift() || [], out = {};
    rows.forEach(function (r) {
      var o = {}; head.forEach(function (h, j) { o[h] = r[j] || ''; });
      if (o.img) out[o.img.trim()] = o;
    });
    return out;
  }
  function liveRow(r) {
    var p = parseFloat(String(r.price).replace(/[^\d.]/g, ''));
    var oos = r.stock === 'FALSE' ? true : r.stock === 'TRUE' ? false : /אזל/.test(r.notes || '');
    return { p: p > 0 ? Math.round(p * 100) / 100 : null, oos: oos, hide: r.hide === 'TRUE', sku: (r.sku || '').trim() };
  }
  function applyLiveToData() {
    if (!LIVE || !DATA) return;
    Object.keys(DATA).forEach(function (id) { var p = DATA[id], r = LIVE[p.img]; if (!r) return; var v = liveRow(r); p.p = v.p; p.oos = v.oos; p.hide = v.hide; });
  }
  function priceHtml(p) {
    return p != null ? '<span class="price"><bdi>' + nf.format(p) + '&nbsp;₪</bdi><small>' + (T.priceVat || '') + '</small></span>' : '<span class="price price-req">' + (T.onRequest || '') + '</span>';
  }
  function applyLiveToPage() {
    if (!LIVE) return;
    // cards (one card = one family of variants)
    $$('.card[data-imgs]').forEach(function (c) {
      var ids = c.getAttribute('data-imgs').split(' '), vis = 0, min = null, allOos = true;
      ids.forEach(function (id) { var r = LIVE[id]; if (!r) { vis++; allOos = false; return; } var v = liveRow(r); if (v.hide) return; vis++; if (!v.oos) allOos = false; if (v.p != null && (min == null || v.p < min)) min = v.p; });
      if (!vis) { c.remove(); return; }
      c.setAttribute('data-p', min == null ? '' : min);
      var slot = c.querySelector('.card-foot .price'); if (slot) {
        var html = ids.length > 1 && min != null ? '<span class="price"><small class="from">' + (T.from || '') + '</small><bdi>' + nf.format(min) + '&nbsp;₪</bdi></span>' : priceHtml(min);
        slot.outerHTML = html;
      }
    });
    // product page variants
    $$('[data-vb][data-img]').forEach(function (b) {
      var r = LIVE[b.getAttribute('data-img')]; if (!r) return; var v = liveRow(r);
      var pr = b.querySelector('.pd-price .price'); if (pr) pr.outerHTML = priceHtml(v.p);
      var av = b.querySelector('.avail'); if (v.oos && !av) { av = document.createElement('span'); av.className = 'avail off'; b.insertBefore(av, b.firstChild); }
      if (av) { av.textContent = v.oos ? (T.outStock || T.preorder) : (T.inStockLbl || ''); av.className = 'avail' + (v.oos ? ' off' : ' on'); }
      if (v.hide) { b.innerHTML = '<p class="avail off">' + (T.unavailable || '') + '</p>'; }
    });
    $$('.vopt[data-img]').forEach(function (o) { var r = LIVE[o.getAttribute('data-img')]; if (!r) return; var v = liveRow(r); var pr = o.querySelector('.price'); if (pr) pr.outerHTML = priceHtml(v.p); if (v.hide) o.hidden = true; });
    applyLiveToData(); renderCart(); if (window.KIRsyncBuybar) window.KIRsyncBuybar();
  }
  if (K.live && window.fetch) {
    var LKEY = 'kir-live-v1', cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(LKEY) || 'null'); } catch (e) {}
    if (cached && Date.now() - cached.t < 120000) { LIVE = cached.d; applyLiveToPage(); }
    else fetch(K.live, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
      if (!txt || txt.indexOf('img') !== 0) return;
      LIVE = parseCsv(txt);
      try { sessionStorage.setItem(LKEY, JSON.stringify({ t: Date.now(), d: LIVE })); } catch (e) {}
      applyLiveToPage();
    }).catch(function () {});
  }

  /* ---------- WhatsApp button: product-aware message ---------- */
  var waf = $('[data-wa-float]');
  if (waf && K.wa) {
    var h1 = $('.pd-info h1');
    if (h1) waf.href = 'https://wa.me/' + K.wa + '?text=' + encodeURIComponent((T.waHello || '') + ' — ' + h1.textContent.trim() + ' ' + location.href);
  }

  /* ---------- Accessibility menu ---------- */
  var a11yBtn = $('[data-a11y-toggle]'), a11yPanel = $('#a11y-panel');
  if (a11yBtn && a11yPanel) {
    var A = load('kir-a11y', {});
    var applyA = function () {
      doc.style.fontSize = A.fs ? A.fs + '%' : '';
      doc.classList.toggle('a11y-contrast', !!A.contrast); doc.classList.toggle('a11y-links', !!A.links); doc.classList.toggle('a11y-motion', !!A.motion);
      $$('[data-a11y]', a11yPanel).forEach(function (b) { var k = b.getAttribute('data-a11y'); if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(!!A[k])); });
      save('kir-a11y', A);
    };
    a11yBtn.addEventListener('click', function () { var open = a11yPanel.hidden; a11yPanel.hidden = !open; a11yBtn.setAttribute('aria-expanded', String(open)); if (open) { var f = a11yPanel.querySelector('button'); if (f) f.focus(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !a11yPanel.hidden) { a11yPanel.hidden = true; a11yBtn.setAttribute('aria-expanded', 'false'); a11yBtn.focus(); } });
    a11yPanel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a11y]'); if (!b) return; var k = b.getAttribute('data-a11y');
      if (k === 'bigger') A.fs = Math.min(150, (A.fs || 100) + 10);
      else if (k === 'smaller') A.fs = Math.max(90, (A.fs || 100) - 10);
      else if (k === 'reset') A = {};
      else A[k] = !A[k];
      applyA();
    });
    applyA();
  }

  /* ---------- Recently viewed products ---------- */
  var RKEY = 'kir-recent-v1';
  var prodPage = $('[data-product]');
  if (prodPage) {
    var h = $('.pd-info h1'), img = $('.gallery:not([hidden]) img');
    if (h && img) {
      var rec = load(RKEY, []).filter(function (x) { return x.u !== location.pathname; });
      rec.unshift({ u: location.pathname, n: h.textContent.trim(), i: img.getAttribute('src') }); save(RKEY, rec.slice(0, 10));
    }
  }
  var recentHost = $('.featured .wrap') || $('.related .wrap');
  var recList = load(RKEY, []).filter(function (x) { return x.u !== location.pathname && x.u.indexOf('/' + K.prefix + 'p/') > -1; });
  if (recentHost && recList.length >= 2) {
    var sec = document.createElement('div'); sec.className = 'recent';
    sec.innerHTML = '<h2 class="recent-title">' + esc(T.recently) + '</h2><div class="recent-row">' + recList.slice(0, 8).map(function (x) { return '<a href="' + esc(x.u) + '"><img src="' + esc(x.i) + '" alt="" loading="lazy"><span>' + esc(x.n) + '</span></a>'; }).join('') + '</div>';
    recentHost.appendChild(sec);
  }

  /* ---------- Language suggestion (first visit, based on browser language) ---------- */
  try {
    if (!localStorage.getItem('kir-lang-asked')) {
      var bl = (navigator.language || '').slice(0, 2), alt = null;
      if (K.lang === 'he' && (bl === 'fr' || bl === 'en')) alt = bl;
      if (alt) {
        var link = $('.langs a[data-lang="' + alt + '"]');
        if (link) {
          var bar = document.createElement('div'); bar.className = 'lang-bar'; bar.setAttribute('dir', 'ltr');
          bar.innerHTML = '<span>' + (alt === 'fr' ? 'Voir le site en français ?' : 'View this site in English?') + '</span><a href="' + link.getAttribute('href') + '">' + (alt === 'fr' ? 'Français' : 'English') + '</a><button type="button" aria-label="close">✕</button>';
          document.body.appendChild(bar);
          var done = function () { localStorage.setItem('kir-lang-asked', '1'); bar.remove(); };
          bar.querySelector('button').addEventListener('click', done); bar.querySelector('a').addEventListener('click', done);
        }
      }
    }
    $$('.langs a').forEach(function (a) { a.addEventListener('click', function () { try { localStorage.setItem('kir-lang-asked', '1'); } catch (e) {} }); });
  } catch (e) {}

  /* ---------- Share (product pages) ---------- */
  $$('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = { title: document.title, url: location.href };
      var waShare = function () { window.open('https://wa.me/?text=' + encodeURIComponent(d.title + ' ' + d.url), '_blank', 'noopener'); };
      if (navigator.share) { navigator.share(d).catch(function () {}); return; }
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(d.url).then(function () { toast(T.copied || 'OK'); }, waShare); return; }
      waShare();
    });
  });
})();
