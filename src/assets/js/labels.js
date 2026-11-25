/* Price labels for the showroom (page /labels/, Hebrew, not indexed): pick products, print A4 sheets.
   Logo, reference, size and price; prices = the site's prices (Sheet column "המחיר שלנו כולל מע״מ",
   updated live by app.js). Choices are kept on this device (localStorage). Requested by Raphael 24/11/2026;
   100 x 50 mm cards (10 per A4, the default) added 25/11/2026. */
(function () {
  'use strict';
  var KEY = 'kir-labels-v1';
  var SIZES = {
    c10: { name: 'כרטיס — 100 × 50 מ״מ', per: 10, cols: 2, note: '10 בדף A4 (דף רגיל או בריסטול, חיתוך לפי הקווים)' },
    a7: { name: 'גדולה — 105 × 74 מ״מ', per: 8, cols: 2, note: '8 בדף A4 (גיליון מדבקות A7 או דף רגיל וחיתוך)' },
    s24: { name: 'קטנה — 70 × 37 מ״מ', per: 24, cols: 3, note: '24 בדף A4 (גיליון מדבקות 70×37)' }
  };
  // card designs (25/11/2026, Raphael: "propose several designs, e.g. price and reference on the same line");
  // '' = the first design (separate lines). Each one is pure CSS on the same markup: .sheet.ds.ds-N in style.css
  var DESIGNS = [
    ['', 'קלאסי', 'מק״ט, מידות ומחיר בשורות נפרדות'],
    ['1', 'שורה אחת', 'מק״ט ומחיר באותה שורה, המידות מתחת'],
    ['2', 'מרכזי', 'הכול ממורכז, המחיר גדול באמצע'],
    ['3', 'פס מחיר', 'פס בז׳ בתחתית עם מק״ט ומחיר'],
    ['4', 'כותרת כהה', 'לוגו על רקע כהה, מק״ט ומחיר באותה שורה'],
    ['5', 'מחיר בצד', 'מחיר גדול בצד, מק״ט ומידות לידו']
  ];
  var root, cats = {}, items = [], byId = {}, st, loadErr = false, loaded = false;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var T = (window.KIR && window.KIR.t) || {};
  var nf = new Intl.NumberFormat('he-IL');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function load() {
    var d = null; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    st = d && typeof d === 'object' ? d : {};
    // v2 (25/11/2026): the 10 x 5 cm card becomes the default, also for a device that had saved another size
    if (st.v !== 2) { st.size = 'c10'; st.v = 2; }
    st.size = SIZES[st.size] ? st.size : 'c10';
    st.sel = st.sel || {}; st.ovr = st.ovr || {};
    st.name = !!st.name; st.cut = st.cut !== false;
    st.skip = Math.max(0, parseInt(st.skip, 10) || 0); st.blank = Math.max(0, parseInt(st.blank, 10) || 0);
    st.ds = DESIGNS.some(function (d) { return d[0] === st.ds; }) ? st.ds : '';
    st.q = st.q || ''; st.c = st.c || ''; st.pf = st.pf === 'y' || st.pf === 'n' ? st.pf : '';
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  // same rule as SizeText in build.ps1: "20/2.90" -> 20 ס״מ × 2.90 מ׳, "12" -> 12 ס״מ, else as written
  function sizeText(s) {
    s = String(s || '').trim(); if (!s) return '';
    var m = s.match(/^(\d+(?:\.\d+)?)\/(\d+\.\d+)$/);
    if (m) return m[1] + ' ' + (T.cm || 'ס״מ') + ' × ' + m[2] + ' ' + (T.m || 'מ׳');
    if (/^\d+(?:\.\d+)?$/.test(s)) return s + ' ' + (T.cm || 'ס״מ');
    return s;
  }
  function field(it, k) {
    var o = st.ovr[it.id] || {};
    if (o[k] != null && o[k] !== '') return o[k];
    if (k === 'r') return it.r || '';
    if (k === 's') return sizeText(it.s);
    if (k === 'p') return it.p != null ? String(it.p) : '';
    return '';
  }
  function hasPrice(it) { return parseFloat(String(field(it, 'p')).replace(/[^\d.]/g, '')) > 0; }
  function priceHtml(p) {
    var n = parseFloat(String(p).replace(/[^\d.]/g, ''));
    return n > 0 ? '<bdi>' + nf.format(n) + '&nbsp;₪</bdi>' : '<span class="lbl-line"></span>';
  }

  /* ---------- the label itself: logo band on top, then reference / size / price over the full width ---------- */
  var logoHtml = '';
  function buildLogo() {
    var mk = $('.site-header .logo-mark'), nm = $('.site-header .logo-name');
    logoHtml = '<div class="lbl-head">' + (mk ? mk.outerHTML : '') + '<span class="lbl-brand">' + (nm ? nm.innerHTML : esc((window.KIR && window.KIR.brand) || '')) + '</span></div>';
  }
  function labelHtml(it) {
    var r = it ? field(it, 'r') : '', s = it ? field(it, 's') : '', p = it ? field(it, 'p') : '';
    var v = function (x, ltr) { return x ? '<span class="v"' + (ltr ? ' dir="ltr"' : '') + '>' + esc(x) + '</span>' : '<span class="v lbl-line"></span>'; };
    return '<div class="lbl">' + logoHtml + '<div class="lbl-body">' +
      (st.name && it ? '<div class="lbl-title">' + esc(it.he || '') + '</div>' : '') +
      '<div class="lbl-row lbl-ref"><span class="k">' + esc(T.sku || 'מק״ט') + '</span>' + v(r, true) + '</div>' +
      '<div class="lbl-row lbl-size"><span class="k">מידות</span>' + v(s) + '</div>' +
      '<div class="lbl-price"><span class="k">מחיר</span><span class="v">' + priceHtml(p) + '</span><small>' + esc(T.priceVat || 'כולל מע״מ') + '</small></div>' +
      '</div></div>';
  }
  function queue() {
    var q = [];
    items.forEach(function (it) { var n = st.sel[it.id] || 0; for (var i = 0; i < n; i++) q.push(it); });
    for (var b = 0; b < st.blank; b++) q.push(null);
    return q;
  }
  function renderSheets() {
    var z = SIZES[st.size], q = queue(), box = $('[data-sheets]', root), info = $('[data-count]', root);
    var total = q.length, slots = st.skip + total, pages = total ? Math.ceil(slots / z.per) : 0;
    info.textContent = total ? total + ' תוויות · ' + pages + (pages === 1 ? ' דף' : ' דפים') : 'עדיין לא נבחרו תוויות';
    $('[data-print]', root).disabled = !total;
    if (!total) { box.innerHTML = '<p class="lbl-empty">בחרו מוצרים מהרשימה (כפתור +) או הוסיפו תוויות ריקות לכתיבה ביד.</p>'; return; }
    var html = '', k = 0;
    for (var pg = 0; pg < pages; pg++) {
      html += '<div class="sheet sz-' + st.size + (st.ds ? ' ds ds-' + st.ds : '') + (st.cut ? ' cut' : '') + '">';
      for (var i = 0; i < z.per; i++, k++) {
        var idx = k - st.skip;
        html += (k < st.skip || idx >= total) ? '<div class="lbl lbl-skip"></div>' : labelHtml(q[idx]);
      }
      html += '</div>';
    }
    box.innerHTML = html; fit();
  }
  function fit() {
    var box = $('[data-sheets]', root); if (!box) return;
    var w = box.clientWidth, sheetPx = 210 * 96 / 25.4;
    box.style.setProperty('--fit', Math.min(1, (w - 2) / sheetPx).toFixed(3));
  }

  /* ---------- product picker ---------- */
  function matches(it) {
    if (st.c && it.c !== st.c) return false;
    if (st.pf && hasPrice(it) !== (st.pf === 'y')) return false;
    var q = st.q.trim().toLowerCase(); if (!q) return true;
    return ((it.r || '') + ' ' + (it.he || '') + ' ' + (it.s || '')).toLowerCase().indexOf(q) >= 0;
  }
  function renderList() {
    var ul = $('[data-list]', root);
    if (loadErr) { ul.innerHTML = '<li class="lbl-msg err">לא הצלחנו לטעון את המוצרים. בדקו את החיבור ורעננו את הדף.</li>'; return; }
    if (!loaded) { ul.innerHTML = '<li class="lbl-msg">טוען את המוצרים…</li>'; return; }
    var shown = items.filter(matches);
    $('[data-shown]', root).textContent = shown.length + ' מוצרים';
    if (!shown.length) { ul.innerHTML = '<li class="lbl-msg">לא נמצאו מוצרים. נסו חיפוש אחר או כל הקטגוריות.</li>'; return; }
    ul.innerHTML = shown.map(function (it) {
      var n = st.sel[it.id] || 0, o = st.ovr[it.id], p = field(it, 'p');
      return '<li class="lbl-item' + (n ? ' on' : '') + '" data-id="' + esc(it.id) + '">' +
        '<div class="li-main"><b><bdi dir="ltr">' + esc(field(it, 'r')) + '</bdi></b><span>' + esc(it.he || '') + '</span>' +
        '<small>' + esc(field(it, 's') || '—') + ' · ' + (p ? esc(nf.format(parseFloat(p) || 0)) + ' ₪' : 'אין מחיר — שורה ריקה לכתיבה') + (o ? ' · <em>נערך</em>' : '') + '</small></div>' +
        '<div class="li-qty"><button type="button" class="qb" data-act="dec" aria-label="פחות">−</button><output aria-live="polite">' + n + '</output><button type="button" class="qb" data-act="inc" aria-label="עוד תווית">+</button></div>' +
        '<button type="button" class="li-edit" data-act="edit" aria-expanded="false">עריכה</button>' +
        '<div class="li-form" hidden><label>מק״ט<input data-k="r" value="' + esc(field(it, 'r')) + '" dir="ltr"></label>' +
        '<label>מידות<input data-k="s" value="' + esc(field(it, 's')) + '"></label>' +
        '<label>מחיר ₪<input data-k="p" inputmode="decimal" value="' + esc(p) + '" dir="ltr"></label>' +
        '<div class="li-form-act"><button type="button" class="btn btn-sm" data-act="ok">שמירה לתווית</button><button type="button" class="btn btn-sm btn-ghost" data-act="reset">חזרה לנתוני האתר</button></div>' +
        '<p class="li-hint">השינוי חל רק על התוויות במכשיר הזה. לשינוי מחיר באתר — עדכנו את הגיליון.</p></div></li>';
    }).join('');
  }
  function toast(msg) {
    var t = $('[data-toast]', root); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function setQty(id, n) { n = Math.max(0, Math.min(99, n)); if (n) st.sel[id] = n; else delete st.sel[id]; save(); }

  function ui() {
    var opt = function (k) { return '<label class="lbl-radio"><input type="radio" name="lsz" value="' + k + '"' + (st.size === k ? ' checked' : '') + '><span><b>' + SIZES[k].name + '</b><small>' + SIZES[k].note + '</small></span></label>'; };
    var catOpts = '<option value="">כל הקטגוריות</option>' + Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '"' + (st.c === c ? ' selected' : '') + '>' + esc(cats[c]) + '</option>'; }).join('');
    root.innerHTML =
      '<div class="labels-ui">' +
      '<fieldset class="lbl-set"><legend>גודל התווית</legend>' + opt('c10') + opt('a7') + opt('s24') + '</fieldset>' +
      '<fieldset class="lbl-set"><legend>עיצוב</legend>' + DESIGNS.map(function (d) { return '<label class="lbl-radio"><input type="radio" name="lds" value="' + d[0] + '"' + (st.ds === d[0] ? ' checked' : '') + '><span><b>' + d[1] + '</b><small>' + d[2] + '</small></span></label>'; }).join('') + '</fieldset>' +
      '<div class="lbl-set lbl-opts">' +
      '<label class="lbl-check"><input type="checkbox" data-o="name"' + (st.name ? ' checked' : '') + '> להציג גם את שם המוצר</label>' +
      '<label class="lbl-check"><input type="checkbox" data-o="cut"' + (st.cut ? ' checked' : '') + '> קווי חיתוך (להדפסה על דף רגיל)</label>' +
      '<label class="lbl-num">תוויות ריקות לכתיבה ביד <input type="number" min="0" max="240" data-o="blank" value="' + st.blank + '"></label>' +
      '<label class="lbl-num">לדלג על תוויות בתחילת הגיליון <input type="number" min="0" max="' + (SIZES[st.size].per - 1) + '" data-o="skip" value="' + st.skip + '"><small>לגיליון מדבקות שכבר השתמשו בחלקו</small></label>' +
      '</div>' +
      '<div class="lbl-bar"><strong data-count aria-live="polite"></strong><button type="button" class="btn" data-print>הדפסה</button><button type="button" class="btn btn-ghost" data-clear>ניקוי הבחירה</button></div>' +
      '<div class="lbl-pick"><div class="lbl-filters"><input type="search" data-q placeholder="חיפוש לפי מק״ט או שם" value="' + esc(st.q) + '" aria-label="חיפוש מוצר"><select data-c aria-label="קטגוריה">' + catOpts + '</select>' +
      '<select data-pf aria-label="מחיר"><option value="">עם ובלי מחיר</option><option value="y"' + (st.pf === 'y' ? ' selected' : '') + '>רק עם מחיר</option><option value="n"' + (st.pf === 'n' ? ' selected' : '') + '>רק בלי מחיר</option></select>' +
      '<span class="lbl-shown" data-shown></span><button type="button" class="btn btn-sm btn-ghost" data-all>תווית אחת לכל מוצר מוצג</button></div>' +
      '<ul class="lbl-list" data-list></ul></div>' +
      '<p class="lbl-toast" data-toast role="status" hidden></p>' +
      '</div>' +
      '<div class="sheets" data-sheets></div>';

    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'lsz') { st.size = t.value; var mx = SIZES[st.size].per - 1; if (st.skip > mx) st.skip = mx; $('[data-o="skip"]', root).max = mx; }
      else if (t.name === 'lds') st.ds = t.value;
      else if (t.dataset.o === 'name' || t.dataset.o === 'cut') st[t.dataset.o] = t.checked;
      else if (t.dataset.o === 'blank') st.blank = Math.max(0, Math.min(240, parseInt(t.value, 10) || 0));
      else if (t.dataset.o === 'skip') st.skip = Math.max(0, Math.min(SIZES[st.size].per - 1, parseInt(t.value, 10) || 0));
      else if (t.matches('[data-c]')) { st.c = t.value; save(); renderList(); return; }
      else if (t.matches('[data-pf]')) { st.pf = t.value; save(); renderList(); return; }
      else return;
      save(); renderSheets();
    });
    $('[data-q]', root).addEventListener('input', function (e) { st.q = e.target.value; save(); renderList(); });
    $('[data-print]', root).addEventListener('click', function () { if (!queue().length) { toast('אין תוויות להדפסה'); return; } window.print(); });
    $('[data-clear]', root).addEventListener('click', function () {
      var n = Object.keys(st.sel).length; if (!n && !st.blank) { toast('אין מה לנקות'); return; }
      if (!confirm('לנקות את כל התוויות שנבחרו (' + n + ' מוצרים' + (st.blank ? ' ו־' + st.blank + ' ריקות' : '') + ')?')) return;
      st.sel = {}; st.blank = 0; $('[data-o="blank"]', root).value = 0; save(); renderList(); renderSheets(); toast('הבחירה נוקתה');
    });
    $('[data-all]', root).addEventListener('click', function () {
      var shown = items.filter(matches), added = 0;
      shown.forEach(function (it) { if (!st.sel[it.id]) { st.sel[it.id] = 1; added++; } });
      save(); renderList(); renderSheets(); toast(added ? 'נוספו ' + added + ' תוויות' : 'כל המוצרים המוצגים כבר נבחרו');
    });
    $('[data-list]', root).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var li = b.closest('[data-id]'), id = li && li.getAttribute('data-id'), it = byId[id]; if (!it) return;
      var act = b.getAttribute('data-act'), form = $('.li-form', li);
      if (act === 'inc' || act === 'dec') { setQty(id, (st.sel[id] || 0) + (act === 'inc' ? 1 : -1)); li.classList.toggle('on', !!st.sel[id]); $('output', li).textContent = st.sel[id] || 0; renderSheets(); }
      else if (act === 'edit') { form.hidden = !form.hidden; b.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) $('input', form).focus(); }
      else if (act === 'ok') {
        var o = {}; Array.prototype.forEach.call(form.querySelectorAll('input'), function (i) { var k = i.getAttribute('data-k'), base = field({ id: '', r: it.r, s: it.s, p: it.p }, k); if (i.value.trim() !== base) o[k] = i.value.trim(); });
        if (Object.keys(o).length) st.ovr[id] = o; else delete st.ovr[id];
        save(); renderList(); renderSheets(); toast('התווית עודכנה');
      } else if (act === 'reset') {
        if (!st.ovr[id]) { toast('אין שינויים לבטל'); return; }
        if (!confirm('לבטל את השינויים בתווית ' + (it.r || '') + '?')) return;
        delete st.ovr[id]; save(); renderList(); renderSheets(); toast('חזרה לנתוני האתר');
      }
    });
    window.addEventListener('resize', fit);
  }

  function init() {
    root = $('[data-labels]'); if (!root) return;
    try { cats = JSON.parse(root.getAttribute('data-cats') || '{}'); } catch (e) { cats = {}; }
    load(); buildLogo(); ui(); renderList(); renderSheets();
    var take = function (data) {
      items = Object.keys(data).map(function (id) { return data[id]; });
      var order = Object.keys(cats);
      items.sort(function (a, b) { return (order.indexOf(a.c) - order.indexOf(b.c)) || String(a.r).localeCompare(String(b.r), 'he', { numeric: true }); });
      byId = {}; items.forEach(function (it) { byId[it.id] = it; });
      Object.keys(st.sel).forEach(function (id) { if (!byId[id]) delete st.sel[id]; });
      loaded = items.length > 0; loadErr = !loaded;
      renderList(); renderSheets();
    };
    if (window.KIRcatalog) window.KIRcatalog(take); else { loadErr = true; renderList(); }
    document.addEventListener('kir:live', function () { if (loaded) { renderList(); renderSheets(); } });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
