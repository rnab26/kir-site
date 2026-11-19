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

  /* Toast */
  var toastEl = $('[data-toast]'), toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
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

  /* Quantity calculator */
  $$('[data-calc]').forEach(function (f) {
    var ww = $('[data-ww]', f), wh = $('[data-wh]', f), sel = $('[data-model]', f);
    var outN = $('[data-n]', f), outC = $('[data-cost]', f), note = $('[data-note]', f);
    var run = function () {
      var o = sel && sel.options[sel.selectedIndex]; if (!o) return;
      var w = parseFloat(o.getAttribute('data-w')), l = parseFloat(o.getAttribute('data-l')) * 100, p = parseFloat(o.getAttribute('data-p'));
      var W = parseFloat(ww.value) || 0, H = parseFloat(wh.value) || 0;
      if (!w || !l || W <= 0 || H <= 0) { outN.textContent = '-'; outC.textContent = '-'; return; }
      var cols = Math.ceil(W / w), rows = Math.ceil(H / l), n = Math.ceil(cols * rows * 1.1);
      outN.textContent = nf.format(n);
      outC.textContent = isNaN(p) ? (T.onRequest || '') : money(n * p);
      var msg = T.waste || '';
      if (rows > 1) msg += ' · ' + (T.tooTall || '');
      if (isNaN(p)) msg += ' · ' + (T.noPrice || '');
      note.textContent = msg;
    };
    [ww, wh, sel].forEach(function (el) { el && el.addEventListener('input', run); });
    run();
  });

  /* Catalog filters */
  var bar = $('[data-filters]');
  if (bar) {
    var grid = $('[data-grid]');
    var cards = $$('.card', grid);
    var q = $('[data-q]', bar), sort = $('[data-sort]', bar), count = $('[data-n]', bar), clear = $('[data-clear]', bar), empty = $('[data-empty]', bar);
    var active = { c: [], look: [], color: [] };
    var params = new URLSearchParams(location.search);
    ['c', 'look', 'color'].forEach(function (g) { var v = params.get(g); if (v) active[g] = v.split(','); });
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
        var ok = (!active.c.length || active.c.indexOf(c.getAttribute('data-c')) > -1)
          && (!active.look.length || active.look.some(function (v) { return (' ' + c.getAttribute('data-looks') + ' ').indexOf(' ' + v + ' ') > -1; }))
          && (!active.color.length || active.color.some(function (v) { return (' ' + c.getAttribute('data-colors') + ' ').indexOf(' ' + v + ' ') > -1; }))
          && (!term || term.split(/\s+/).every(function (w) { return c.getAttribute('data-q').indexOf(w) > -1; }));
        c.hidden = !ok; if (ok) n++;
      });
      if (count) count.textContent = nf.format(n);
      var any = active.c.length || active.look.length || active.color.length || term;
      if (clear) clear.hidden = !any;
      if (empty) empty.hidden = n > 0;
      if (push && history.replaceState) {
        var p = new URLSearchParams();
        ['c', 'look', 'color'].forEach(function (g) { if (active[g].length) p.set(g, active[g].join(',')); });
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
      active = { c: [], look: [], color: [] }; if (q) q.value = '';
      $$('.chip', bar).forEach(function (c) { c.setAttribute('aria-pressed', 'false'); }); apply(true);
    });
    apply(false);
  }

  /* Quote list (localStorage, per browser) */
  var KEY = 'kir-list-v1';
  var load = function () { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  var save = function (l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} };
  var list = load();
  var countEls = $$('[data-count]');
  var refresh = function () {
    var n = Object.keys(list).length;
    countEls.forEach(function (c) { c.textContent = n; c.hidden = n === 0; });
    $$('[data-add]').forEach(function (b) {
      var on = !!list[b.getAttribute('data-add')];
      b.classList.toggle('on', on);
      if (b.hasAttribute('data-label')) b.textContent = on ? T.added : T.add;
      b.setAttribute('aria-pressed', String(on));
    });
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-add]'); if (!b) return;
    e.preventDefault();
    var id = b.getAttribute('data-add');
    if (list[id]) { delete list[id]; } else { list[id] = 1; toast(T.added); var lb = $('.list-btn'); if (lb) { lb.classList.remove('bump'); void lb.offsetWidth; lb.classList.add('bump'); } }
    save(list); refresh(); renderList();
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) { list = load(); refresh(); renderList(); } });
  refresh();

  var listBox = $('[data-list]'), DATA = null;
  function getData(cb) {
    if (DATA) return cb(DATA);
    fetch(K.data).then(function (r) { return r.json(); }).then(function (d) { DATA = {}; d.forEach(function (p) { DATA[p.id] = p; }); cb(DATA); }).catch(function () { cb({}); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function renderList() {
    if (!listBox) return;
    getData(function (D) {
      var ids = Object.keys(list).filter(function (id) { return D[id]; });
      if (!ids.length) { listBox.innerHTML = '<p class="lead">' + esc(T.listEmpty) + '</p><p><a class="btn" href="' + K.base + '/' + K.prefix + 'catalog/">' + esc(T.viewAll) + '</a></p>'; return; }
      var total = 0, lines = [];
      var html = '<ul class="qlist">' + ids.map(function (id) {
        var p = D[id], qn = list[id] || 1, name = p[K.lang] || p.he;
        if (p.p != null) total += p.p * qn;
        lines.push('• ' + name + ' | ' + T.sku + ' ' + p.r + (p.s ? ' | ' + p.s : '') + ' | ' + T.qty + ': ' + qn);
        return '<li class="qitem"><img src="' + K.base + '/assets/img/thumb/' + p.img + '.jpg" alt="" width="64" height="80" loading="lazy">' +
          '<div><a href="' + productUrl(id, p.f) + '">' + esc(name) + '</a><small><bdi>' + esc(p.r) + '</bdi>' + (p.p != null ? ' · ' + money(p.p) : ' · ' + esc(T.onRequest)) + '</small></div>' +
          '<label class="qty"><span class="sr">' + esc(T.qty) + '</span><input type="number" min="1" max="9999" value="' + qn + '" data-qty="' + id + '"></label>' +
          '<button class="qremove" type="button" data-rm="' + id + '" aria-label="' + esc(T.remove) + '">✕</button></li>';
      }).join('') + '</ul>';
      if (total) html += '<p class="qtotal"><span>' + esc(T.estTotal) + '</span><span>' + money(total) + '</span></p>';
      var msg = T.listIntro + '\n' + lines.join('\n') + '\n\n' + location.origin + K.base + '/' + K.prefix;
      html += '<div class="qactions">' + (K.wa ? '<a class="btn btn-dark" href="https://wa.me/' + K.wa + '?text=' + encodeURIComponent(msg) + '" rel="noopener">' + esc(T.sendWa) + '</a>' : '') +
        '<button class="btn" type="button" data-copy>' + esc(T.copy) + '</button></div>' + (K.wa ? '' : '<p class="note">' + esc(T.noContact) + '</p>');
      listBox.innerHTML = html;
      $$('[data-qty]', listBox).forEach(function (inp) {
        inp.addEventListener('change', function () { var v = Math.max(1, parseInt(inp.value, 10) || 1); list[inp.getAttribute('data-qty')] = v; save(list); renderList(); });
      });
      $$('[data-rm]', listBox).forEach(function (b) { b.addEventListener('click', function () { delete list[b.getAttribute('data-rm')]; save(list); refresh(); renderList(); }); });
      var cp = $('[data-copy]', listBox);
      if (cp) cp.addEventListener('click', function () {
        var done = function () { toast(T.copied); };
        if (navigator.clipboard) navigator.clipboard.writeText(msg).then(done, function () {}); else { var ta = document.createElement('textarea'); ta.value = msg; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
      });
    });
  }
  renderList();

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
    };
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
})();
