/* Internal shop page (/pro/): build a quote fast by reference, send it to the customer, split it into one
   purchase order per supplier, keep a history with statuses.
   Everything stays in this browser (localStorage): supplier names and phone numbers are never published.
   Texts: window.KIRproT (data/content-shop.json > pro). Documents: quote.js (window.KIRquote). */
(function () {
  'use strict';
  var K = window.KIR || {}, PT = window.KIRproT || {}, S = K.shop || {};
  var root = document.querySelector('[data-pro]');
  if (!root) return;
  function t(k) { return PT[k] != null ? PT[k] : k; }
  var Q = null, DATA = {}, LIST = [];
  var LS = { draft: 'kir-pro-draft-v1', orders: 'kir-pro-orders-v1', cfg: 'kir-pro-cfg-v1', tab: 'kir-pro-tab' };
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast(t('saveFail'), true); return false; } }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (s, r) { return (r || root).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); };
  var toastEl = document.querySelector('[data-toast]'), toastTimer;
  function toast(msg, bad) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.toggle('bad', !!bad); toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, bad ? 5000 : 2400);
  }

  var cfg = load(LS.cfg, null) || {};
  cfg = { sups: cfg.sups || [{ code: (S.def || 'S1'), name: '', wa: '', contact: '', notes: '' }], def: cfg.def || S.def || 'S1', days: cfg.days || +S.days || 14,
    staff: cfg.staff || '', note: cfg.note || '', poLang: cfg.poLang || 'he' };
  function saveCfg() { save(LS.cfg, cfg); }
  var orders = load(LS.orders, []);
  function saveOrders() { save(LS.orders, orders.slice(0, 1000)); }
  function blank() {
    return { id: '', date: new Date().toISOString(), lang: K.lang || 'he', items: [], c: { name: '', phone: '', city: '', address: '', delivery: 'pickup', notes: '' },
      disc: { v: 0, pct: false }, deliv: 0, status: 'draft', po: {}, saved: false, from: '' };
  }
  var draft = load(LS.draft, null) || blank();
  function touch() {
    if (!draft.id) draft.id = Q.newId();
    save(LS.draft, draft);
    if (draft.saved) upsert(false);
  }

  var ST = ['draft', 'quote', 'check', 'confirmed', 'deposit', 'ordered', 'paid', 'delivered', 'cancelled'];
  var PST = ['todo', 'sent', 'ok', 'paid', 'received', 'issue'];

  /* ---------- catalogue ---------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[\s.\-\/_״׳"']+/g, ''); }
  function supOf(p) { return String((p && p.sup) || cfg.def || 'S1').trim().toUpperCase(); }
  function supInfo(code) { for (var i = 0; i < cfg.sups.length; i++) if (String(cfg.sups[i].code).toUpperCase() === code) return cfg.sups[i]; return null; }
  function pname(p, lang) { return p ? (p[lang || K.lang] || p.he || p.r) : ''; }
  function full(o) {
    var miss = 0;
    var items = o.items.map(function (x) {
      var p = DATA[x.id];
      if (!p) { miss++; return { id: x.id, r: x.r || x.id, s: x.s || '', q: x.q, p: x.p, p0: x.p0, img: x.img || '', sup: x.sup || cfg.def, nm: x.nm || { he: x.id }, missing: true }; }
      return { id: p.id, f: p.f, r: p.r, s: p.s, q: x.q, p: x.p === undefined ? p.p : x.p, p0: p.p, img: p.img, sup: supOf(p), nm: { he: p.he, fr: p.fr, en: p.en } };
    });
    var f = JSON.parse(JSON.stringify(o)); f.items = items; f.missing = miss;
    f.days = cfg.days; f.staff = cfg.staff; f.note = cfg.note;
    return f;
  }
  function search(q) {
    var n = norm(q); if (!n) return [];
    var out = [];
    LIST.forEach(function (p) {
      if (p.hide) return;
      var r = norm(p.r), score = -1;
      if (r === n) score = 100; else if (r.indexOf(n) === 0) score = 80; else if (r.indexOf(n) >= 0) score = 60;
      else if (norm(p.he).indexOf(n) >= 0 || norm(p.fr).indexOf(n) >= 0 || norm(p.en).indexOf(n) >= 0) score = 40;
      if (score >= 0) out.push({ p: p, s: score });
    });
    out.sort(function (a, b) { return b.s - a.s || String(a.p.r).localeCompare(String(b.p.r)); });
    return out.slice(0, 8).map(function (x) { return x.p; });
  }
  function addItem(id, q) {
    var p = DATA[id]; if (!p) return false;
    q = Math.max(1, Math.min(99999, parseInt(q, 10) || 1));
    for (var i = 0; i < draft.items.length; i++) if (draft.items[i].id === id) { draft.items[i].q += q; touch(); toast(t('qtyUpdated') + ' — ' + p.r); return true; }
    draft.items.push({ id: id, q: q, r: p.r, s: p.s, img: p.img, nm: { he: p.he, fr: p.fr, en: p.en } });
    touch(); toast(t('added') + ' — ' + p.r);
    return true;
  }
  var money = function (n) { return Q.money(n, K.lang); };

  /* ---------- shell ---------- */
  var TABS = ['items', 'client', 'sup', 'hist', 'cfg'];
  function shell() {
    root.innerHTML =
      '<div class="pro">' +
      '<div class="pro-top"><p class="pro-no" data-top></p><div class="pro-top-act"><button class="btn" type="button" data-new>' + esc(t('newQuote')) + '</button></div></div>' +
      '<nav class="pro-tabs" role="tablist">' + TABS.map(function (k) { return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="false">' + esc(t('tab_' + k)) + '<span class="pro-badge" data-badge="' + k + '" hidden></span></button>'; }).join('') + '</nav>' +
      TABS.map(function (k) { return '<section class="pro-pane" data-pane="' + k + '" role="tabpanel" hidden></section>'; }).join('') +
      '</div>';
    $$('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-tab')); }); });
    $('[data-new]').addEventListener('click', function () {
      if (draft.items.length && !draft.saved && !confirm(t('confirmNew'))) return;
      draft = blank(); touch(); renderAll(); show('items'); toast(t('newDone'));
      var q = $('[data-q]'); if (q) q.focus();
    });
  }
  var cur = 'items';
  function show(k) {
    cur = k; try { sessionStorage.setItem(LS.tab, k); } catch (e) { }
    $$('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === k)); });
    $$('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== k; });
    render(k);
    window.scrollTo({ top: Math.max(0, root.getBoundingClientRect().top + window.scrollY - 90), behavior: 'smooth' });
  }
  function render(k) {
    if (k === 'items') renderItems(); else if (k === 'client') renderClient(); else if (k === 'sup') renderSup(); else if (k === 'hist') renderHist(); else renderCfg();
    renderTop();
  }
  function renderAll() { render(cur); }
  function renderTop() {
    var T = Q.totals(full(draft));
    $('[data-top]').innerHTML = esc(t('quoteNo')) + ' <bdi>' + esc(draft.id || '—') + '</bdi> · <span class="pro-st st-' + draft.status + '">' + esc(t('st_' + draft.status)) + '</span>' +
      (draft.saved ? ' · <span class="pro-saved">' + esc(t('savedHist')) + '</span>' : '') + (draft.c.name ? ' · ' + esc(draft.c.name) : '');
    var bi = $('[data-badge="items"]'); bi.textContent = T.n; bi.hidden = !T.n;
    var groups = split(full(draft)); var bs = $('[data-badge="sup"]'); bs.textContent = groups.length; bs.hidden = !groups.length;
    var bh = $('[data-badge="hist"]'); bh.textContent = orders.length; bh.hidden = !orders.length;
  }

  /* ---------- tab 1: items ---------- */
  function renderItems() {
    var pane = $('[data-pane="items"]');
    if (!pane.firstChild) {
      pane.innerHTML =
        '<div class="pro-add"><label class="fld pro-qfld"><span>' + esc(t('searchLbl')) + '</span><input type="search" data-q autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="' + esc(t('searchPh')) + '" aria-controls="pro-sugg"></label>' +
        '<label class="fld pro-qn"><span>' + esc(t('qty')) + '</span><input type="number" data-qn min="1" max="99999" value="1" inputmode="numeric"></label>' +
        '<button class="btn btn-dark" type="button" data-addq>' + esc(t('add')) + '</button></div>' +
        '<ul class="pro-sugg" id="pro-sugg" data-sugg role="listbox"></ul>' +
        '<p class="pro-cartimp" data-cartimp hidden></p>' +
        '<details class="pro-bulk"><summary>' + esc(t('bulkSum')) + '</summary><label class="fld"><span>' + esc(t('bulkLbl')) + '</span><textarea data-bulk rows="5" dir="ltr" placeholder="082 20325  12&#10;035 20025  x4"></textarea></label>' +
        '<button class="btn" type="button" data-bulkgo>' + esc(t('bulkGo')) + '</button><p class="note" data-bulkmsg aria-live="polite"></p></details>' +
        '<div data-lines></div><div data-sum></div>';
      var q = $('[data-q]', pane), qn = $('[data-qn]', pane), sugg = $('[data-sugg]', pane), hi = 0, res = [];
      var drawSugg = function () {
        res = search(q.value); hi = 0;
        if (!q.value.trim()) { sugg.innerHTML = ''; return; }
        sugg.innerHTML = res.length ? res.map(function (p, i) {
          return '<li role="option" data-pick="' + esc(p.id) + '"' + (i === 0 ? ' aria-selected="true"' : '') + '><img src="' + K.base + '/assets/img/thumb/' + esc(p.img) + '.jpg" alt="" width="40" height="50" loading="lazy"><span><b><bdi>' + esc(p.r) + '</bdi></b> ' + esc(pname(p)) +
            '<small><bdi>' + esc(p.s || '') + '</bdi> · ' + (p.p != null ? money(p.p) : esc(t('onRequest'))) + ' · ' + esc(supOf(p)) + (p.oos ? ' · ' + esc(t('oos')) : '') + '</small></span></li>';
        }).join('') : '<li class="pro-none">' + esc(t('noMatch')) + '</li>';
      };
      var pick = function (id) {
        if (addItem(id, qn.value)) { q.value = ''; qn.value = 1; sugg.innerHTML = ''; drawLines(); renderTop(); q.focus(); }
      };
      q.addEventListener('input', drawSugg);
      q.addEventListener('keydown', function (e) {
        var lis = $$('[data-pick]', sugg);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!lis.length) return; hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length; lis.forEach(function (l, i) { l.setAttribute('aria-selected', String(i === hi)); }); lis[hi].scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); if (res[hi]) pick(res[hi].id); else if (q.value.trim()) toast(t('noMatch'), true); }
        else if (e.key === 'Escape') { sugg.innerHTML = ''; }
      });
      qn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (res[hi]) pick(res[hi].id); } });
      sugg.addEventListener('click', function (e) { var li = e.target.closest('[data-pick]'); if (li) pick(li.getAttribute('data-pick')); });
      $('[data-addq]', pane).addEventListener('click', function () { if (res[hi]) pick(res[hi].id); else { toast(q.value.trim() ? t('noMatch') : t('typeRef'), true); q.focus(); } });
      $('[data-bulkgo]', pane).addEventListener('click', function () {
        var ok = 0, bad = [];
        $('[data-bulk]', pane).value.split(/\n+/).forEach(function (line) {
          line = line.trim(); if (!line) return;
          var m = line.match(/^(.*?)(?:\s*[x×*]\s*|\s+)(\d+)\s*$/i), ref = m ? m[1] : line, qty = m ? m[2] : 1;
          var n = norm(ref), hit = null;
          LIST.forEach(function (p) { if (!hit && !p.hide && norm(p.r) === n) hit = p; });
          if (!hit && m) { n = norm(line); LIST.forEach(function (p) { if (!hit && !p.hide && norm(p.r) === n) { hit = p; qty = 1; } }); }
          if (hit) { addItem(hit.id, qty); ok++; } else bad.push(ref);
        });
        $('[data-bulkmsg]', pane).textContent = t('bulkDone').replace('{n}', ok) + (bad.length ? ' ' + t('bulkBad') + ' ' + bad.join(', ') : '');
        $('[data-bulkmsg]', pane).className = 'note' + (bad.length ? ' err' : ' ok');
        if (!bad.length) $('[data-bulk]', pane).value = '';
        drawLines(); renderTop();
      });
    }
    // products added from the public site (cart) can be imported
    var cart = load('kir-list-v1', {}), ids = Object.keys(cart).filter(function (id) { return DATA[id]; });
    var ci = $('[data-cartimp]', pane);
    if (ids.length) {
      ci.hidden = false;
      ci.innerHTML = esc(t('cartHas').replace('{n}', ids.length)) + ' <button class="link" type="button" data-cartgo>' + esc(t('cartImport')) + '</button>';
      $('[data-cartgo]', ci).onclick = function () {
        ids.forEach(function (id) { addItem(id, cart[id] || 1); });
        if (confirm(t('cartClear'))) { try { localStorage.setItem('kir-list-v1', '{}'); } catch (e) { } }
        renderItems(); renderTop();
      };
    } else ci.hidden = true;
    drawLines();
  }
  function drawLines() {
    var pane = $('[data-pane="items"]'), box = $('[data-lines]', pane), sum = $('[data-sum]', pane);
    var f = full(draft);
    if (!f.items.length) {
      box.innerHTML = '<div class="pro-empty"><p class="lead">' + esc(t('emptyItems')) + '</p><p><a class="link" href="' + K.base + '/' + (K.prefix || '') + 'catalog/">' + esc(t('openCatalog')) + '</a></p></div>';
      sum.innerHTML = ''; return;
    }
    box.innerHTML = '<ul class="pro-lines">' + f.items.map(function (x, i) {
      var price = x.p == null || x.p === '' ? '' : x.p;
      return '<li class="pro-line' + (x.missing ? ' missing' : '') + '" data-i="' + i + '">' +
        (x.img ? '<img src="' + K.base + '/assets/img/thumb/' + esc(x.img) + '.jpg" alt="" width="56" height="70" loading="lazy">' : '<span class="pro-noimg"></span>') +
        '<div class="pro-li-info"><b><bdi>' + esc(x.r) + '</bdi></b> <span>' + esc(Q.nameOf(x, K.lang)) + '</span><small><bdi>' + esc(x.s || '') + '</bdi> · <span class="pro-sup">' + esc(x.sup) + '</span> · <bdi>' + esc(Q.ourCode(x)) + '</bdi>' +
        (x.missing ? ' · <em class="oos">' + esc(t('missing')) + '</em>' : '') + '</small></div>' +
        '<div class="pro-li-q"><button type="button" data-dq="-1" aria-label="−">−</button><input type="number" min="1" max="99999" inputmode="numeric" value="' + x.q + '" data-q-i aria-label="' + esc(t('qty')) + '"><button type="button" data-dq="1" aria-label="+">+</button></div>' +
        '<label class="pro-li-p"><small class="pro-li-lbl">' + esc(t('unitPrice')) + ' (₪)</small><input type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(price) + '" placeholder="' + esc(t('onRequest')) + '" data-p-i>' +
        (x.p0 != null && +x.p !== +x.p0 ? '<button type="button" class="link" data-reset-p>' + esc(t('catalogPrice')) + ' ' + money(x.p0) + '</button>' : '') + '</label>' +
        '<strong class="pro-li-t">' + (price !== '' ? money(x.p * x.q) : '—') + '</strong>' +
        '<button class="qremove" type="button" data-rm aria-label="' + esc(t('remove')) + '">✕</button></li>';
    }).join('') + '</ul>';
    var T = Q.totals(f);
    sum.innerHTML = '<div class="pro-sum"><div class="pro-adj">' +
      '<label class="fld"><span>' + esc(t('discount')) + '</span><span class="pro-inline"><input type="number" min="0" step="0.01" inputmode="decimal" value="' + (+draft.disc.v || '') + '" data-disc><select data-discpct><option value="0"' + (draft.disc.pct ? '' : ' selected') + '>₪</option><option value="1"' + (draft.disc.pct ? ' selected' : '') + '>%</option></select></span></label>' +
      '<label class="fld"><span>' + esc(t('deliveryFee')) + '</span><input type="number" min="0" step="1" inputmode="decimal" value="' + (+draft.deliv || '') + '" data-deliv></label></div>' +
      '<dl class="sum">' + (T.disc || T.deliv ? '<div><dt>' + esc(t('subtotal')) + '</dt><dd>' + money(T.sub) + '</dd></div>' : '') +
      (T.disc ? '<div><dt>' + esc(t('discount')) + '</dt><dd>− ' + money(T.disc) + '</dd></div>' : '') + (T.deliv ? '<div><dt>' + esc(t('deliveryFee')) + '</dt><dd>' + money(T.deliv) + '</dd></div>' : '') +
      '<div class="sum-total"><dt>' + esc(t('total')) + '</dt><dd>' + money(T.total) + '</dd></div></dl>' + (T.quote ? '<p class="note">+ ' + T.quote + ' ' + esc(t('quoteItems')) + '</p>' : '') +
      '<div class="pro-next"><button class="btn" type="button" data-clear>' + esc(t('clear')) + '</button><button class="btn btn-dark" type="button" data-go="client">' + esc(t('nextClient')) + '</button></div></div>';
    $$('.pro-line', box).forEach(function (li) {
      var i = +li.getAttribute('data-i'), it = draft.items[i];
      var qi = $('[data-q-i]', li), pi = $('[data-p-i]', li);
      var upd = function () { touch(); drawLines(); renderTop(); };
      $$('[data-dq]', li).forEach(function (b) { b.addEventListener('click', function () { it.q = Math.max(1, it.q + +b.getAttribute('data-dq')); upd(); }); });
      qi.addEventListener('change', function () { it.q = Math.max(1, Math.min(99999, parseInt(qi.value, 10) || 1)); upd(); });
      pi.addEventListener('change', function () { var v = pi.value.trim(); it.p = v === '' ? null : Math.max(0, Math.round(parseFloat(v) * 100) / 100); upd(); });
      var rp = $('[data-reset-p]', li); if (rp) rp.addEventListener('click', function () { delete it.p; upd(); });
      $('[data-rm]', li).addEventListener('click', function () { draft.items.splice(i, 1); upd(); toast(t('removed')); });
    });
    $('[data-disc]', sum).addEventListener('change', function (e) { draft.disc.v = Math.max(0, parseFloat(e.target.value) || 0); touch(); drawLines(); renderTop(); });
    $('[data-discpct]', sum).addEventListener('change', function (e) { draft.disc.pct = e.target.value === '1'; touch(); drawLines(); renderTop(); });
    $('[data-deliv]', sum).addEventListener('change', function (e) { draft.deliv = Math.max(0, parseFloat(e.target.value) || 0); touch(); drawLines(); renderTop(); });
    $('[data-clear]', sum).addEventListener('click', function () { if (!confirm(t('confirmClear'))) return; draft.items = []; touch(); drawLines(); renderTop(); toast(t('cleared')); });
    $('[data-go]', sum).addEventListener('click', function () { show('client'); });
  }

  /* ---------- tab 2: customer + quote ---------- */
  function upsert(announce) {
    var f = JSON.parse(JSON.stringify(draft)); f.saved = true; f.updated = new Date().toISOString();
    f.total = Q.totals(full(draft)).total;
    var at = -1; for (var i = 0; i < orders.length; i++) if (orders[i].id === draft.id) at = i;
    if (at >= 0) orders[at] = f; else orders.unshift(f);
    saveOrders();
    if (announce) toast(t('savedOk'));
  }
  function saveDraft() {
    if (!draft.items.length) { toast(t('emptyItems'), true); return false; }
    if (draft.status === 'draft') draft.status = 'quote';
    draft.saved = true; touch(); upsert(true); renderTop(); return true;
  }
  function renderClient() {
    var pane = $('[data-pane="client"]'), c = draft.c, f = full(draft);
    if (!f.items.length) { pane.innerHTML = '<div class="pro-empty"><p class="lead">' + esc(t('emptyItems')) + '</p><button class="btn" type="button" data-go="items">' + esc(t('tab_items')) + '</button></div>'; $('[data-go]', pane).onclick = function () { show('items'); }; return; }
    var fld = function (k, type, extra) { return '<label class="fld"><span>' + esc(t('c_' + k)) + '</span><input name="' + k + '" type="' + type + '" value="' + esc(c[k] || '') + '"' + (extra || '') + '></label>'; };
    pane.innerHTML = '<form class="pro-client" data-cform novalidate>' +
      (draft.from ? '<p class="note ok">' + esc(t('fromLink')) + ' ' + esc(draft.from) + '</p>' : '') +
      '<div class="pro-grid2">' + fld('name', 'text', ' autocomplete="off"') + fld('phone', 'tel', ' inputmode="tel" dir="ltr" autocomplete="off"') + fld('city', 'text') + fld('address', 'text') + '</div>' +
      '<fieldset class="pro-radios"><legend>' + esc(t('c_delivery')) + '</legend><label class="opt"><input type="radio" name="delivery" value="pickup"' + (c.delivery !== 'delivery' ? ' checked' : '') + '> ' + esc(t('pickup')) + '</label><label class="opt"><input type="radio" name="delivery" value="delivery"' + (c.delivery === 'delivery' ? ' checked' : '') + '> ' + esc(t('delivery')) + '</label></fieldset>' +
      '<label class="fld"><span>' + esc(t('c_notes')) + '</span><textarea name="notes" rows="2">' + esc(c.notes || '') + '</textarea></label>' +
      '<div class="pro-grid2"><label class="fld"><span>' + esc(t('docLang')) + '</span><select name="lang">' + ['he', 'fr', 'en'].map(function (l) { return '<option value="' + l + '"' + (draft.lang === l ? ' selected' : '') + '>' + esc(t('lang_' + l)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld"><span>' + esc(t('status')) + '</span><select name="status">' + ST.map(function (s) { return '<option value="' + s + '"' + (draft.status === s ? ' selected' : '') + '>' + esc(t('st_' + s)) + '</option>'; }).join('') + '</select></label></div>' +
      '</form>' +
      '<div class="pro-send"><button class="btn btn-dark" type="button" data-save>' + esc(draft.saved ? t('saveAgain') : t('saveHist')) + '</button>' +
      '<button class="btn btn-wa" type="button" data-wa-client>' + esc(t('sendClient')) + '</button><button class="btn" type="button" data-copy>' + esc(t('copyText')) + '</button></div>' +
      '<p class="note" data-cmsg aria-live="polite"></p>' +
      '<div class="pro-doc" data-doc-wrap><div data-doc></div>' + Q.actionsHtml(true) + '</div>';
    var form = $('[data-cform]', pane), act = null;
    var drawDoc = function () {
      $('[data-doc]', pane).innerHTML = Q.html(Q.quoteModel(full(draft), draft.lang));
      if (act) act.reset();
    };
    drawDoc();
    act = Q.actions($('[data-doc-actions]', pane), function () { return Q.quoteModel(full(draft), draft.lang); }, 'devis-' + draft.id, function () { return Q.quoteText(full(draft), draft.lang, 'offer', Q.linkFor(full(draft))); });
    var timer;
    form.addEventListener('input', function (e) {
      var el = e.target; if (!el.name) return;
      if (el.name === 'lang') draft.lang = el.value; else if (el.name === 'status') draft.status = el.value; else draft.c[el.name] = el.type === 'radio' ? form.delivery.value : el.value.trim();
      touch(); renderTop();
      clearTimeout(timer); timer = setTimeout(drawDoc, 400);
    });
    form.addEventListener('change', function (e) { if (e.target.name === 'delivery') { draft.c.delivery = form.delivery.value; touch(); drawDoc(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    $('[data-save]', pane).addEventListener('click', function () { if (saveDraft()) $('[data-save]', pane).textContent = t('saveAgain'); });
    var msg = $('[data-cmsg]', pane);
    $('[data-wa-client]', pane).addEventListener('click', function () {
      if (!draft.c.phone) { msg.textContent = t('noPhone'); msg.className = 'note err'; form.phone.focus(); }
      saveDraft();
      var f2 = full(draft);
      window.open(Q.wa(draft.c.phone, Q.quoteText(f2, draft.lang, 'offer', Q.linkFor(f2))), '_blank', 'noopener');
    });
    $('[data-copy]', pane).addEventListener('click', function () {
      var f2 = full(draft), txt = Q.quoteText(f2, draft.lang, 'offer', Q.linkFor(f2));
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast(t('copied')); }, function () { msg.textContent = t('copyFail'); msg.className = 'note err'; });
    });
  }

  /* ---------- tab 3: purchase orders, one per supplier ---------- */
  function split(f) {
    var g = {}, order = [];
    f.items.forEach(function (x) { var k = String(x.sup || cfg.def).toUpperCase(); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(x); });
    return order.map(function (k) { return { code: k, items: g[k] }; });
  }
  function renderSup() {
    var pane = $('[data-pane="sup"]'), f = full(draft), groups = split(f);
    if (!groups.length) { pane.innerHTML = '<div class="pro-empty"><p class="lead">' + esc(t('emptyItems')) + '</p></div>'; return; }
    pane.innerHTML = '<p class="lead pro-intro">' + esc(t('supIntro').replace('{n}', groups.length)) + '</p>' + groups.map(function (g) {
      var info = supInfo(g.code), po = draft.po[g.code] || { st: 'todo', direct: false };
      return '<article class="pro-po" data-code="' + esc(g.code) + '"><header><h3>' + (info && info.name ? esc(info.name) : esc(t('supUnknown').replace('{code}', g.code))) + ' <small>' + esc(g.code) + ' · ' + g.items.length + ' ' + esc(t('lines')) + '</small></h3>' +
        '<label class="pro-inline"><span>' + esc(t('status')) + '</span><select data-pst>' + PST.map(function (s) { return '<option value="' + s + '"' + (po.st === s ? ' selected' : '') + '>' + esc(t('pst_' + s)) + '</option>'; }).join('') + '</select></label></header>' +
        (info && info.name ? '' : '<p class="note err">' + esc(t('supSetup')) + ' <button class="link" type="button" data-go="cfg">' + esc(t('tab_cfg')) + '</button></p>') +
        '<label class="opt"><input type="checkbox" data-direct' + (po.direct ? ' checked' : '') + '> ' + esc(t('directDelivery')) + '</label>' +
        '<div class="pro-send"><button class="btn btn-wa" type="button" data-wa-sup>' + esc(t('sendSup')) + '</button><button class="btn" type="button" data-copy-sup>' + esc(t('copyText')) + '</button></div>' +
        '<div class="pro-doc" data-doc-wrap><div data-doc></div>' + Q.actionsHtml(true) + '</div></article>';
    }).join('');
    $$('.pro-po', pane).forEach(function (card) {
      var code = card.getAttribute('data-code'), g = groups.filter(function (x) { return x.code === code; })[0];
      var info = supInfo(code) || { code: code, name: '', wa: '' };
      var po = function () { return draft.po[code] || (draft.po[code] = { st: 'todo', direct: false }); };
      var model = function () { return Q.poModel(full(draft), info, g.items, cfg.poLang, po().direct); };
      var text = function () { return Q.poText(full(draft), info, g.items, cfg.poLang, po().direct); };
      var draw = function () { $('[data-doc]', card).innerHTML = Q.html(model()); };
      draw();
      var act = Q.actions($('[data-doc-actions]', card), model, 'commande-' + draft.id + '-' + code, text);
      $('[data-pst]', card).addEventListener('change', function (e) { po().st = e.target.value; touch(); });
      $('[data-direct]', card).addEventListener('change', function (e) { po().direct = e.target.checked; touch(); draw(); act.reset(); });
      $('[data-wa-sup]', card).addEventListener('click', function () {
        if (!info.wa) toast(t('noSupPhone'), true);
        saveDraft(); if (po().st === 'todo') { po().st = 'sent'; $('[data-pst]', card).value = 'sent'; touch(); }
        window.open(Q.wa(info.wa, text()), '_blank', 'noopener');
      });
      $('[data-copy-sup]', card).addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(text()) : Promise.reject()).then(function () { toast(t('copied')); }, function () { toast(t('copyFail'), true); }); });
      var go = $('[data-go]', card); if (go) go.addEventListener('click', function () { show('cfg'); });
    });
  }

  /* ---------- tab 4: history ---------- */
  function renderHist() {
    var pane = $('[data-pane="hist"]');
    if (!orders.length) { pane.innerHTML = '<div class="pro-empty"><p class="lead">' + esc(t('noHist')) + '</p></div>'; return; }
    if (!$('[data-hq]', pane)) {
      pane.innerHTML = '<div class="pro-hbar"><label class="fld"><span>' + esc(t('histSearch')) + '</span><input type="search" data-hq autocomplete="off"></label>' +
        '<label class="fld"><span>' + esc(t('status')) + '</span><select data-hst><option value="">' + esc(t('allStatus')) + '</option>' + ST.map(function (s) { return '<option value="' + s + '">' + esc(t('st_' + s)) + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn" type="button" data-csv>' + esc(t('exportCsv')) + '</button></div><div data-hlist></div>';
      $('[data-hq]', pane).addEventListener('input', drawHist);
      $('[data-hst]', pane).addEventListener('change', drawHist);
      $('[data-csv]', pane).addEventListener('click', exportCsv);
    }
    drawHist();
  }
  function drawHist() {
    var pane = $('[data-pane="hist"]'), q = norm($('[data-hq]', pane).value), fs = $('[data-hst]', pane).value;
    var list = orders.filter(function (o) { return (!fs || o.status === fs) && (!q || norm(o.id + ' ' + o.c.name + ' ' + o.c.phone + ' ' + o.c.city).indexOf(q) >= 0); });
    var box = $('[data-hlist]', pane);
    if (!list.length) { box.innerHTML = '<p class="lead">' + esc(t('noMatch')) + '</p>'; return; }
    box.innerHTML = list.map(function (o) {
      var n = o.items.reduce(function (a, x) { return a + x.q; }, 0), pos = Object.keys(o.po || {});
      return '<article class="pro-h" data-id="' + esc(o.id) + '"><header><strong><bdi>' + esc(o.id) + '</bdi></strong><span>' + new Date(o.updated || o.date).toLocaleString(K.lang === 'he' ? 'he-IL' : K.lang === 'fr' ? 'fr-FR' : 'en-GB') + '</span></header>' +
        '<p>' + esc(o.c.name || t('noName')) + (o.c.phone ? ' · <bdi>' + esc(o.c.phone) + '</bdi>' : '') + ' · ' + n + ' ' + esc(t('units')) + ' · <b>' + money(o.total || 0) + '</b></p>' +
        (pos.length ? '<p class="note">' + pos.map(function (k) { var s = supInfo(k); return esc((s && s.name) || k) + ' : ' + esc(t('pst_' + o.po[k].st)); }).join(' · ') + '</p>' : '') +
        '<div class="pro-hact"><select data-hset aria-label="' + esc(t('status')) + '">' + ST.map(function (s) { return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + esc(t('st_' + s)) + '</option>'; }).join('') + '</select>' +
        '<button class="btn" type="button" data-hopen>' + esc(t('open')) + '</button><button class="btn" type="button" data-hdup>' + esc(t('duplicate')) + '</button><button class="link danger" type="button" data-hdel>' + esc(t('delete')) + '</button></div></article>';
    }).join('');
    $$('.pro-h', box).forEach(function (card) {
      var id = card.getAttribute('data-id'), idx = function () { for (var i = 0; i < orders.length; i++) if (orders[i].id === id) return i; return -1; };
      $('[data-hset]', card).addEventListener('change', function (e) { var o = orders[idx()]; o.status = e.target.value; o.updated = new Date().toISOString(); saveOrders(); if (draft.id === id) { draft.status = o.status; save(LS.draft, draft); } renderTop(); toast(t('savedOk')); });
      $('[data-hopen]', card).addEventListener('click', function () {
        if (draft.items.length && !draft.saved && draft.id !== id && !confirm(t('confirmReplace'))) return;
        draft = JSON.parse(JSON.stringify(orders[idx()])); save(LS.draft, draft); show('items');
      });
      $('[data-hdup]', card).addEventListener('click', function () {
        if (draft.items.length && !draft.saved && !confirm(t('confirmReplace'))) return;
        var o = JSON.parse(JSON.stringify(orders[idx()])); o.id = Q.newId(); o.date = new Date().toISOString(); o.status = 'draft'; o.saved = false; o.po = {}; o.from = '';
        draft = o; save(LS.draft, draft); show('items'); toast(t('duplicated'));
      });
      $('[data-hdel]', card).addEventListener('click', function () {
        if (!confirm(t('confirmDelete').replace('{id}', id))) return;
        orders.splice(idx(), 1); saveOrders(); if (draft.id === id) { draft.saved = false; save(LS.draft, draft); }
        renderHist(); renderTop(); toast(t('deleted'));
      });
    });
  }
  function exportCsv() {
    var rows = [[t('quoteNo'), t('date'), t('c_name'), t('c_phone'), t('c_city'), t('total'), t('status')]].concat(orders.map(function (o) {
      return [o.id, (o.updated || o.date).slice(0, 10), o.c.name, o.c.phone, o.c.city, (o.total || 0).toFixed(2), t('st_' + o.status)];
    }));
    var csv = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    Q.download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'devis-' + new Date().toISOString().slice(0, 10) + '.csv');
  }

  /* ---------- tab 5: settings ---------- */
  function renderCfg() {
    var pane = $('[data-pane="cfg"]');
    pane.innerHTML = '<p class="note pro-private">' + esc(t('privateNote')) + '</p>' +
      '<h3>' + esc(t('suppliers')) + '</h3><p class="note">' + esc(t('supHelp')) + '</p><div data-sups></div>' +
      '<button class="btn" type="button" data-supadd>' + esc(t('supAdd')) + '</button>' +
      '<div class="pro-grid2 pro-cfg2"><label class="fld"><span>' + esc(t('supDefault')) + '</span><select data-def></select></label>' +
      '<label class="fld"><span>' + esc(t('poLang')) + '</span><select data-polang>' + ['he', 'fr', 'en'].map(function (l) { return '<option value="' + l + '"' + (cfg.poLang === l ? ' selected' : '') + '>' + esc(t('lang_' + l)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld"><span>' + esc(t('validDays')) + '</span><input type="number" min="1" max="365" data-days value="' + esc(cfg.days) + '" inputmode="numeric"></label>' +
      '<label class="fld"><span>' + esc(t('staffName')) + '</span><input type="text" data-staff value="' + esc(cfg.staff) + '"></label></div>' +
      '<label class="fld"><span>' + esc(t('quoteNote')) + '</span><textarea rows="2" data-qnote>' + esc(cfg.note) + '</textarea></label>' +
      '<h3>' + esc(t('dataTitle')) + '</h3><p class="note">' + esc(t('dataHelp')) + '</p>' +
      '<div class="pro-send"><button class="btn" type="button" data-exp>' + esc(t('exportAll')) + '</button><label class="btn pro-file">' + esc(t('importAll')) + '<input type="file" accept="application/json,.json" data-imp hidden></label>' +
      '<button class="btn" type="button" data-cfglink>' + esc(t('cfgLink')) + '</button></div><p class="note" data-cfgmsg aria-live="polite"></p>';
    drawSups();
    var on = function (sel, ev, fn) { $(sel, pane).addEventListener(ev, fn); };
    on('[data-supadd]', 'click', function () {
      var n = cfg.sups.length + 1, code = 'S' + n; while (supInfo(code)) code = 'S' + (++n);
      cfg.sups.push({ code: code, name: '', wa: '', contact: '', notes: '' }); saveCfg(); drawSups();
      var last = $$('[data-sup]', pane).pop(); if (last) $('[data-f="name"]', last).focus();
    });
    on('[data-def]', 'change', function (e) { cfg.def = e.target.value; saveCfg(); toast(t('savedOk')); renderTop(); });
    on('[data-polang]', 'change', function (e) { cfg.poLang = e.target.value; saveCfg(); toast(t('savedOk')); });
    on('[data-days]', 'change', function (e) { cfg.days = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 14)); e.target.value = cfg.days; saveCfg(); toast(t('savedOk')); });
    on('[data-staff]', 'change', function (e) { cfg.staff = e.target.value.trim(); saveCfg(); toast(t('savedOk')); });
    on('[data-qnote]', 'change', function (e) { cfg.note = e.target.value.trim(); saveCfg(); toast(t('savedOk')); });
    var msg = $('[data-cfgmsg]', pane);
    on('[data-exp]', 'click', function () {
      Q.download(new Blob([JSON.stringify({ kind: 'kir-pro', v: 1, at: new Date().toISOString(), cfg: cfg, orders: orders }, null, 1)], { type: 'application/json' }), 'kir-pro-' + new Date().toISOString().slice(0, 10) + '.json');
      msg.textContent = t('exported'); msg.className = 'note ok';
    });
    on('[data-imp]', 'change', function (e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result); if (!j || j.kind !== 'kir-pro') throw 0;
          if (!confirm(t('confirmImport').replace('{n}', (j.orders || []).length))) return;
          if (j.cfg) { cfg = Object.assign(cfg, j.cfg); saveCfg(); }
          var have = {}; orders.forEach(function (o) { have[o.id] = 1; });
          (j.orders || []).forEach(function (o) { if (o && o.id && !have[o.id]) orders.push(o); });
          orders.sort(function (a, b) { return String(b.updated || b.date).localeCompare(String(a.updated || a.date)); });
          saveOrders(); renderCfg(); renderTop(); toast(t('imported'));
        } catch (err) { msg.textContent = t('importBad'); msg.className = 'note err'; }
      };
      rd.readAsText(file);
    });
    on('[data-cfglink]', 'click', function () {
      var link = location.origin + location.pathname + '#cfg=' + Q.b64e(JSON.stringify(cfg));
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { msg.textContent = t('cfgLinkOk'); msg.className = 'note ok'; }, function () { msg.textContent = link; msg.className = 'note'; });
    });
  }
  function drawSups() {
    var pane = $('[data-pane="cfg"]'), box = $('[data-sups]', pane);
    box.innerHTML = cfg.sups.map(function (s, i) {
      var f = function (k, type, extra) { return '<label class="fld"><span>' + esc(t('sup_' + k)) + '</span><input type="' + type + '" data-f="' + k + '" value="' + esc(s[k] || '') + '"' + (extra || '') + '></label>'; };
      return '<fieldset class="pro-supcard" data-sup="' + i + '"><legend>' + esc(s.code) + (s.name ? ' · ' + esc(s.name) : '') + '</legend><div class="pro-grid2">' +
        f('code', 'text', ' maxlength="6" dir="ltr" autocapitalize="characters"') + f('name', 'text') + f('wa', 'tel', ' dir="ltr" inputmode="tel" placeholder="05x-xxx-xxxx"') + f('contact', 'text') + '</div>' + f('notes', 'text') +
        '<button class="link danger" type="button" data-supdel>' + esc(t('delete')) + '</button></fieldset>';
    }).join('');
    $$('[data-sup]', box).forEach(function (fs) {
      var i = +fs.getAttribute('data-sup');
      $$('[data-f]', fs).forEach(function (inp) {
        inp.addEventListener('change', function () {
          var k = inp.getAttribute('data-f'), v = inp.value.trim();
          if (k === 'code') {
            v = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
            var dup = cfg.sups.some(function (s, j) { return j !== i && String(s.code).toUpperCase() === v; });
            if (!v || dup) { toast(t('codeBad'), true); inp.value = cfg.sups[i].code; return; }
            if (cfg.def === cfg.sups[i].code) cfg.def = v;
            inp.value = v;
          }
          cfg.sups[i][k] = v; saveCfg(); toast(t('savedOk'));
          $('legend', fs).textContent = cfg.sups[i].code + (cfg.sups[i].name ? ' · ' + cfg.sups[i].name : '');
          drawDef();
        });
      });
      $('[data-supdel]', fs).addEventListener('click', function () {
        var s = cfg.sups[i];
        if (!confirm(t('confirmSupDel').replace('{name}', s.name || s.code))) return;
        cfg.sups.splice(i, 1); if (!cfg.sups.length) cfg.sups.push({ code: 'S1', name: '', wa: '', contact: '', notes: '' });
        if (!supInfo(String(cfg.def).toUpperCase())) cfg.def = cfg.sups[0].code;
        saveCfg(); drawSups(); toast(t('deleted'));
      });
    });
    drawDef();
  }
  function drawDef() {
    var sel = $('[data-pane="cfg"] [data-def]'); if (!sel) return;
    sel.innerHTML = cfg.sups.map(function (s) { return '<option value="' + esc(s.code) + '"' + (String(cfg.def).toUpperCase() === String(s.code).toUpperCase() ? ' selected' : '') + '>' + esc(s.code + (s.name ? ' · ' + s.name : '')) + '</option>'; }).join('');
  }

  /* ---------- links: #q= (a customer request) and #cfg= (settings from another device) ---------- */
  function readHash() {
    var h = location.hash || '';
    if (h.indexOf('#q=') === 0) {
      var o = Q.unpack(h.slice(3));
      history.replaceState(null, '', location.pathname);
      if (!o) { toast(t('badLink'), true); return; }
      var known = orders.filter(function (x) { return x.id === o.id; })[0];
      if (known) { draft = JSON.parse(JSON.stringify(known)); save(LS.draft, draft); toast(t('alreadyHist')); return; }
      if (draft.items.length && !draft.saved && !confirm(t('confirmReplace'))) return;
      var d = blank(); d.id = o.id; d.date = o.date; d.lang = o.lang; d.c = Object.assign(d.c, o.c); d.disc = o.disc; d.deliv = o.deliv; d.status = 'check'; d.from = o.c.name || o.id;
      d.items = o.items.map(function (x) { var p = DATA[x.id]; var it = { id: x.id, q: x.q, r: p ? p.r : x.id, s: p ? p.s : '', img: p ? p.img : '', nm: p ? { he: p.he, fr: p.fr, en: p.en } : { he: x.id } }; if (p && x.p != null && +x.p !== +p.p) it.p = x.p; return it; });
      draft = d; save(LS.draft, draft); toast(t('loadedReq').replace('{name}', d.from));
    } else if (h.indexOf('#cfg=') === 0) {
      var c = null; try { c = JSON.parse(Q.b64d(h.slice(5))); } catch (e) { }
      history.replaceState(null, '', location.pathname);
      if (!c || !c.sups) { toast(t('badLink'), true); return; }
      if (confirm(t('confirmCfg').replace('{n}', c.sups.length))) { cfg = Object.assign(cfg, c); saveCfg(); toast(t('imported')); }
    }
  }

  function boot() {
    Q = window.KIRquote;
    if (!Q || !window.KIRcatalog) { root.innerHTML = '<p class="lead err">' + esc(t('loadFail')) + '</p>'; return; }
    root.innerHTML = '<p class="lead pro-loading">' + esc(t('loading')) + '</p>';
    var timer = setTimeout(function () { root.innerHTML = '<p class="lead err">' + esc(t('loadFail')) + '</p><button class="btn" type="button" onclick="location.reload()">' + esc(t('retry')) + '</button>'; }, 15000);
    window.KIRcatalog(function (D) {
      clearTimeout(timer);
      DATA = D || {}; LIST = Object.keys(DATA).map(function (k) { return DATA[k]; });
      if (!LIST.length) { root.innerHTML = '<p class="lead err">' + esc(t('loadFail')) + '</p><button class="btn" type="button" onclick="location.reload()">' + esc(t('retry')) + '</button>'; return; }
      readHash();
      shell();
      var tab = null; try { tab = sessionStorage.getItem(LS.tab); } catch (e) { }
      show(TABS.indexOf(tab) >= 0 ? tab : 'items');
      if (draft.from && cur === 'items') toast(t('loadedReq').replace('{name}', draft.from));
    });
    document.addEventListener('kir:live', function () { if (Q && LIST.length) render(cur); });
    window.addEventListener('hashchange', function () { if (location.hash.length > 3) { readHash(); render(cur); } });
  }
  // deferred scripts run before DOMContentLoaded: wait for it, so app.js (catalogue loader) is ready
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
