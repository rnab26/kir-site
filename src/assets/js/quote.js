/* Quotes (devis) and supplier purchase orders.
   One document model, drawn two ways: HTML (screen, print / PDF) and a JPEG image (canvas) that can be
   shared on WhatsApp. Used by the shop pages (customer quote requests) and the internal /pro/ page.
   Texts: window.KIRdoc[lang] (data/content-shop.json > doc). Shop facts: window.KIR.shop (data/site.json). */
(function () {
  'use strict';
  var K = window.KIR || {}, DOC = window.KIRdoc || {}, S = K.shop || {};
  function tr(lang) { return DOC[lang] || DOC[K.lang] || DOC.he || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function loc(lang) { return lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-GB' : 'he-IL'; }
  function money(n, lang) { return new Intl.NumberFormat(loc(lang), { maximumFractionDigits: 2 }).format(Math.round((+n || 0) * 100) / 100) + ' ₪'; }
  function fmtDate(iso, lang) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(loc(lang)); }
  function addDays(iso, n) { var d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString(); }
  function vatRate() { var v = parseFloat(S.vat); return v >= 0 ? v : 18; }
  function by(map, lang) { return map ? (map[lang] || map.he || '') : ''; }
  function thumb(img) { return (K.base || '') + '/assets/img/thumb/' + img + '.jpg'; }
  function nameOf(x, lang) { return (x.nm && (x.nm[lang] || x.nm.he)) || x.n || x.r || ''; }
  function refKey(r) { return String(r || '').replace(/[\s.\-\/]+/g, '').toUpperCase(); }
  // our internal code: supplier code + supplier reference without spaces (S1-08220325)
  function ourCode(x, sup) { return (sup || x.sup || S.def || 'S1').toUpperCase() + '-' + refKey(x.r); }
  // left-to-right island for references and amounts inside Hebrew text (else '082 20325' shows as '20325 082')
  function ltr(s) { return s ? '⁦' + s + '⁩' : ''; }
  function fill(s, o) { return String(s || '').replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : ''; }); }
  function newId() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'HI-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* Totals. Prices include VAT. Items without a price ("on request") are counted apart. */
  function totals(o) {
    var sub = 0, quote = 0;
    (o.items || []).forEach(function (x) { if (x.p != null && x.p !== '') sub += (+x.p) * x.q; else quote++; });
    var disc = 0;
    if (o.disc && +o.disc.v > 0) disc = o.disc.pct ? sub * (+o.disc.v) / 100 : +o.disc.v;
    disc = Math.min(Math.max(disc, 0), sub);
    var deliv = Math.max(+o.deliv || 0, 0), total = sub - disc + deliv;
    return { sub: sub, disc: disc, deliv: deliv, total: total, vat: total * vatRate() / (100 + vatRate()), quote: quote, n: (o.items || []).reduce(function (a, x) { return a + (+x.q || 0); }, 0) };
  }
  function priced(x) { return x.p != null && x.p !== ''; }

  /* ---------- document models ---------- */
  function head(lang) {
    var t = tr(lang), line = [by(S.addrs, lang), S.phone ? (t.qPhone || '') + ' ' + S.phone : ''].filter(Boolean).join(' · ');
    return { brand: by(S.brands, lang) || K.brand || '', sub: line, biz: S.biz ? (t.qBiz || '') + ' ' + S.biz : '' };
  }
  function partyLines(c, t) {
    if (!c) return [];
    var out = [];
    if (c.name) out.push(c.name);
    if (c.phone) out.push(c.phone);
    var place = [c.city, c.address].filter(Boolean).join(', ');
    if (place) out.push(place);
    if (c.delivery) out.push(c.delivery === 'delivery' ? t.delivery : t.pickup);
    return out;
  }
  function quoteModel(o, lang) {
    lang = lang || o.lang || K.lang || 'he';
    var t = tr(lang), T = totals(o), days = +o.days || +S.days || 14;
    var tot = [];
    if (T.disc || T.deliv) tot.push([t.qSubtotal, money(T.sub, lang)]);
    if (T.disc) tot.push([t.qDiscount + (o.disc.pct ? ' ' + (+o.disc.v) + '%' : ''), ltr('− ' + money(T.disc, lang))]);
    if (T.deliv) tot.push([t.qDelivery, money(T.deliv, lang)]);
    tot.push([t.qTotal, money(T.total, lang), true]);
    tot.push([fill(t.qVatIncl, { vat: vatRate() }), money(T.vat, lang)]);
    var notes = [];
    if (T.quote) notes.push('+ ' + T.quote + ' ' + (t.quoteItems || ''));
    if (o.c && o.c.notes) notes.push((t.qNotes || '') + ' : ' + o.c.notes);
    if (o.note) notes.push(o.note);
    var meta = [[t.qDate, fmtDate(o.date, lang)], [t.qValid, fmtDate(addDays(o.date, days), lang)]];
    if (o.staff) meta.push([t.qSeller, o.staff]);
    return {
      kind: 'quote', lang: lang, dir: lang === 'he' ? 'rtl' : 'ltr', head: head(lang), title: t.qTitle, number: o.id, meta: meta,
      partyLabel: t.qClient, party: partyLines(o.c, t), priced: true,
      cols: { name: t.qProduct, q: t.qQty, unit: t.qUnit, total: t.qLineTotal },
      rows: (o.items || []).map(function (x) {
        return {
          img: x.img, name: nameOf(x, lang), sub: [x.r ? (t.qRef || '') + ' ' + ltr(x.r) : '', ltr(x.s)].filter(Boolean).join(' · '), q: x.q,
          unit: priced(x) ? money(x.p, lang) : (t.onRequest || '—'), total: priced(x) ? money(x.p * x.q, lang) : '—',
          was: x.p0 != null && priced(x) && +x.p0 !== +x.p ? money(x.p0, lang) : ''
        };
      }),
      totals: tot, notes: notes, foot: [t.qCond]
    };
  }
  /* Purchase order for one supplier: supplier reference first, our code, quantity. No sale prices. */
  function poModel(o, sup, items, lang, direct) {
    lang = lang || 'he';
    var t = tr(lang), meta = [[t.qDate, fmtDate(new Date().toISOString(), lang)], [t.poClientRef, o.id]];
    var party = [sup.name || sup.code, sup.contact, sup.wa].filter(Boolean);
    var notes = [];
    if (direct && o.c) notes.push(t.poDirect + ' : ' + partyLines(o.c, t).join(' · '));
    return {
      kind: 'po', lang: lang, dir: lang === 'he' ? 'rtl' : 'ltr', head: head(lang), title: t.poTitle, number: o.id + '-' + sup.code, meta: meta,
      partyLabel: t.poFor, party: party, priced: false,
      cols: { name: t.qProduct, q: t.qQty },
      rows: items.map(function (x) {
        return { img: x.img, big: ltr(x.r || ''), name: nameOf(x, lang), sub: [ltr(x.s), (t.poCode || '') + ' ' + ltr(ourCode(x, sup.code))].filter(Boolean).join(' · '), q: x.q };
      }),
      totals: [[t.qQty, String(items.reduce(function (a, x) { return a + (+x.q || 0); }, 0)), true]], notes: notes, foot: [t.poFoot]
    };
  }

  /* ---------- HTML (screen + print) ---------- */
  function html(m) {
    var logo = (K.base || '') + '/assets/img/logo.png';
    var h = '<article class="qdoc qdoc-' + m.kind + '" dir="' + m.dir + '" lang="' + m.lang + '">';
    h += '<header class="qd-head"><div class="qd-brand"><img src="' + logo + '" alt="" width="56" height="56"><div><strong>' + esc(m.head.brand) + '</strong><small>' + esc(m.head.sub) + '</small>' + (m.head.biz ? '<small>' + esc(m.head.biz) + '</small>' : '') + '</div></div>';
    h += '<div class="qd-meta"><h2>' + esc(m.title) + '</h2><p class="qd-no"><bdi>' + esc(m.number) + '</bdi></p><dl>' + m.meta.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd><bdi>' + esc(r[1]) + '</bdi></dd></div>'; }).join('') + '</dl></div></header>';
    if (m.party.length) h += '<section class="qd-party"><h3>' + esc(m.partyLabel) + '</h3><p>' + m.party.map(function (l) { return '<bdi>' + esc(l) + '</bdi>'; }).join('<br>') + '</p></section>';
    h += '<table class="qd-table"><thead><tr><th class="c-img"><span class="sr">' + esc(m.cols.name) + '</span></th><th class="c-name">' + esc(m.cols.name) + '</th><th class="c-q">' + esc(m.cols.q) + '</th>' + (m.priced ? '<th class="c-u">' + esc(m.cols.unit) + '</th><th class="c-t">' + esc(m.cols.total) + '</th>' : '') + '</tr></thead><tbody>';
    m.rows.forEach(function (r) {
      h += '<tr><td class="c-img">' + (r.img ? '<img src="' + thumb(r.img) + '" alt="" width="48" height="60" loading="lazy">' : '') + '</td><td class="c-name">' + (r.big ? '<b class="qd-big"><bdi>' + esc(r.big) + '</bdi></b>' : '') + '<span class="qd-pname">' + esc(r.name) + '</span><small><bdi>' + esc(r.sub) + '</bdi></small></td><td class="c-q" data-l="' + esc(m.cols.q) + '"><bdi>' + esc(r.q) + '</bdi></td>';
      if (m.priced) h += '<td class="c-u" data-l="' + esc(m.cols.unit) + '"><bdi>' + esc(r.unit) + '</bdi>' + (r.was ? '<s><bdi>' + esc(r.was) + '</bdi></s>' : '') + '</td><td class="c-t"><bdi>' + esc(r.total) + '</bdi></td>';
      h += '</tr>';
    });
    h += '</tbody></table><dl class="qd-totals">' + m.totals.map(function (r) { return '<div' + (r[2] ? ' class="grand"' : '') + '><dt>' + esc(r[0]) + '</dt><dd><bdi>' + esc(r[1]) + '</bdi></dd></div>'; }).join('') + '</dl>';
    if (m.notes.length) h += '<div class="qd-notes">' + m.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</div>';
    h += '<footer class="qd-foot">' + m.foot.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</footer></article>';
    return h;
  }

  /* ---------- image (canvas) ---------- */
  function loadImg(src) {
    return new Promise(function (res) { var im = new Image(); im.decoding = 'async'; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = src; });
  }
  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) cur = test; else { lines.push(cur); cur = words[i]; }
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length === maxLines && (lines.join(' ').length < words.join(' ').length)) {
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }
  var FONT = '"Assistant", "Segoe UI", system-ui, sans-serif', SERIF = '"Frank Ruhl Libre", "Times New Roman", serif';
  function image(m) {
    var fontsOk = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('700 30px Assistant'), document.fonts.load('400 24px Assistant'), document.fonts.load('700 44px "Frank Ruhl Libre"')
    ]).catch(function () {}) : Promise.resolve();
    var srcs = [(K.base || '') + '/assets/img/logo.png'].concat(m.rows.map(function (r) { return r.img ? thumb(r.img) : ''; }));
    return Promise.all([fontsOk].concat(srcs.map(function (s) { return s ? loadImg(s) : Promise.resolve(null); }))).then(function (res) {
      var logo = res[1], imgs = res.slice(2);
      var W = 1080, P = 52, rtl = m.dir === 'rtl';
      var cv = document.createElement('canvas'); cv.setAttribute('dir', m.dir); cv.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(cv);
      var ctx = cv.getContext('2d');
      var X = function (l) { return rtl ? W - l : l; };
      // align helpers: 'start' text at LTR coordinate l, 'end' text whose LTR right edge is at l
      var txt = function (s, l, y, side) {
        var end = side === 'end';
        ctx.textAlign = rtl ? (end ? 'left' : 'right') : (end ? 'right' : 'left');
        ctx.fillText(String(s == null ? '' : s), X(l), y);
      };
      var font = function (w, px, fam) { ctx.font = w + ' ' + px + 'px ' + (fam || FONT); };
      try { ctx.direction = m.dir; } catch (e) { }
      // columns (LTR coordinates)
      var photoW = 76, photoH = 95, qW = m.priced ? 96 : 150, uW = m.priced ? 170 : 0, tW = m.priced ? 180 : 0;
      var nameL = P + photoW + 22, nameR = W - P - qW - uW - tW - 16, nameW = nameR - nameL;
      // measure rows
      var rows = m.rows.map(function (r) {
        font('700', 27); var nl = wrap(ctx, r.name, nameW, 2);
        font('400', 22); var sl = wrap(ctx, r.sub, nameW, 2);
        var h = (r.big ? 38 : 0) + nl.length * 34 + sl.length * 28 + 18;
        return { r: r, nl: nl, sl: sl, h: Math.max(h, photoH + 22) };
      });
      font('400', 22); var foot = []; m.notes.concat(m.foot).forEach(function (n) { foot = foot.concat(wrap(ctx, n, W - 2 * P, 6)); });
      var partyH = m.party.length ? 46 + m.party.length * 32 + 20 : 0;
      var headH = Math.max(210, 162 + m.meta.length * 25), theadH = 50, totH = m.totals.length * 44 + 30;
      var H = headH + partyH + theadH + rows.reduce(function (a, x) { return a + x.h; }, 0) + totH + foot.length * 30 + 70;
      cv.width = W; cv.height = Math.ceil(H);
      try { ctx.direction = m.dir; } catch (e) { }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'alphabetic';
      // header band
      ctx.fillStyle = '#f3eee6'; ctx.fillRect(0, 0, W, headH - 24);
      ctx.fillStyle = '#a07a50'; ctx.fillRect(0, headH - 28, W, 4);
      var bx = P;
      if (logo) { var lh = 84, lw = logo.width / logo.height * lh; ctx.drawImage(logo, rtl ? W - P - lw : P, 40, lw, lh); bx = P + lw + 18; }
      ctx.fillStyle = '#1b1916'; font('700', 34, SERIF); txt(m.head.brand, bx, 76);
      ctx.fillStyle = '#463f37'; font('400', 21);
      var hl = wrap(ctx, m.head.sub, 470, 2); hl.forEach(function (l, i) { txt(l, bx, 108 + i * 26); });
      if (m.head.biz) txt(m.head.biz, bx, 108 + hl.length * 26);
      ctx.fillStyle = '#1b1916'; font('700', 44, SERIF); txt(m.title, W - P, 78, 'end');
      ctx.fillStyle = '#7a5a36'; font('700', 24); txt(m.number, W - P, 112, 'end');
      ctx.fillStyle = '#463f37'; font('400', 21);
      m.meta.forEach(function (r, i) { txt(r[0] + ' : ' + r[1], W - P, 142 + i * 25, 'end'); });
      var y = headH;
      if (m.party.length) {
        ctx.fillStyle = '#7a5a36'; font('700', 20); txt(String(m.partyLabel).toUpperCase(), P, y + 28);
        ctx.fillStyle = '#1b1916'; font('600', 26);
        m.party.forEach(function (l, i) { txt(l, P, y + 64 + i * 32); });
        y += partyH;
      }
      // table head
      ctx.fillStyle = '#ebe3d6'; ctx.fillRect(P - 12, y, W - 2 * P + 24, theadH - 8);
      ctx.fillStyle = '#463f37'; font('700', 20);
      txt(m.cols.name, nameL, y + 28);
      txt(m.cols.q, W - P - uW - tW - 8, y + 28, 'end');
      if (m.priced) { txt(m.cols.unit, W - P - tW - 8, y + 28, 'end'); txt(m.cols.total, W - P, y + 28, 'end'); }
      y += theadH;
      rows.forEach(function (row, i) {
        var r = row.r, im = imgs[i], top = y + 10;
        if (im) {
          var s = Math.max(photoW / im.width, photoH / im.height), sw = photoW / s, sh = photoH / s;
          ctx.save(); ctx.beginPath(); var px = rtl ? W - P - photoW : P;
          if (ctx.roundRect) ctx.roundRect(px, top, photoW, photoH, 10); else ctx.rect(px, top, photoW, photoH);
          ctx.clip(); ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, px, top, photoW, photoH); ctx.restore();
        }
        var ty = top + 26;
        if (r.big) { ctx.fillStyle = '#1b1916'; font('700', 30); txt(r.big, nameL, ty + 4); ty += 38; }
        ctx.fillStyle = '#1b1916'; font(r.big ? '600' : '700', 27); row.nl.forEach(function (l) { txt(l, nameL, ty); ty += 34; });
        ctx.fillStyle = '#6a6157'; font('400', 22); row.sl.forEach(function (l) { txt(l, nameL, ty - 4); ty += 28; });
        ctx.fillStyle = '#1b1916'; font('700', m.priced ? 28 : 40); txt(String(r.q), W - P - uW - tW - 8, top + (m.priced ? 30 : 44), 'end');
        if (m.priced) {
          font('400', 24); txt(r.unit, W - P - tW - 8, top + 30, 'end');
          if (r.was) { ctx.fillStyle = '#6a6157'; font('400', 19); txt(r.was, W - P - tW - 8, top + 56, 'end'); ctx.fillStyle = '#1b1916'; }
          font('700', 26); txt(r.total, W - P, top + 30, 'end');
        }
        y += row.h;
        ctx.fillStyle = 'rgba(27,25,22,.12)'; ctx.fillRect(P - 12, y - 1, W - 2 * P + 24, 1);
      });
      y += 24;
      m.totals.forEach(function (r) {
        ctx.fillStyle = r[2] ? '#1b1916' : '#463f37'; font(r[2] ? '700' : '400', r[2] ? 32 : 23);
        txt(r[0], W - P - 260, y + 28, 'end'); txt(r[1], W - P, y + 28, 'end');
        y += 44;
      });
      y += 16;
      ctx.fillStyle = '#6a6157'; font('400', 21);
      foot.forEach(function (l) { txt(l, P, y + 24); y += 30; });
      return new Promise(function (resolve) {
        var done = function (b) { cv.remove(); resolve(b); };
        if (cv.toBlob) cv.toBlob(done, 'image/jpeg', 0.9);
        else { var d = cv.toDataURL('image/jpeg', 0.9), bin = atob(d.split(',')[1]), u = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); done(new Blob([u], { type: 'image/jpeg' })); }
      });
    });
  }

  /* ---------- share / download ---------- */
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return 'downloaded';
  }
  function share(blob, name, text) {
    var file = null;
    try { file = new File([blob], name, { type: blob.type }); } catch (e) { }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], text: text || '' }).then(function () { return 'shared'; }, function (e) { return e && e.name === 'AbortError' ? 'cancel' : download(blob, name); });
    }
    return Promise.resolve(download(blob, name));
  }
  /* A button group (image / download / print) bound to one document. The image is prepared ahead,
     so the share sheet opens straight from the tap (phones refuse it after a long wait). */
  function actions(box, getModel, fileBase, text) {
    var t = tr(K.lang), blob = null, busy = null, docEl = box.closest('[data-doc-wrap]') || box.parentNode;
    var st = box.querySelector('[data-img-st]');
    var say = function (m, cls) { if (st) { st.textContent = m || ''; st.className = 'note' + (cls ? ' ' + cls : ''); } };
    var prep = function () {
      if (blob) return Promise.resolve(blob);
      if (!busy) { say(t.qPreparing); busy = image(getModel()).then(function (b) { blob = b; say(''); return b; }, function () { busy = null; say(t.qImgFail, 'err'); return null; }); }
      return busy;
    };
    var reset = function () { blob = null; busy = null; };
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'share' || act === 'dl') {
        if (!blob) { prep().then(function (x) { if (x) say(t.qReady + ' — ' + b.textContent.trim(), 'ok'); }); return; }
        var name = fileBase + '.jpg';
        (act === 'share' ? share(blob, name, typeof text === 'function' ? text() : text) : Promise.resolve(download(blob, name))).then(function (r) {
          if (r === 'shared') say(t.qShared, 'ok'); else if (r === 'downloaded') say(t.qDownloaded, 'ok');
        });
      } else if (act === 'print') { printOne(docEl.querySelector('.qdoc')); }
    });
    if ('requestIdleCallback' in window) requestIdleCallback(function () { prep(); }, { timeout: 2500 }); else setTimeout(prep, 800);
    return { reset: function () { reset(); prep(); } };
  }
  function actionsHtml(withShare) {
    var t = tr(K.lang);
    return '<div class="qd-actions" data-doc-actions>' + (withShare ? '<button class="btn btn-dark" type="button" data-act="share">' + esc(t.qShare) + '</button>' : '') +
      '<button class="btn" type="button" data-act="dl">' + esc(t.qDownload) + '</button><button class="btn" type="button" data-act="print">' + esc(t.qPrint) + '</button><p class="note" data-img-st aria-live="polite"></p></div>';
  }
  // print only this document: a copy goes into #print-root, everything else is hidden while printing
  function printOne(el) {
    if (!el) { window.print(); return; }
    var pr = document.getElementById('print-root');
    if (!pr) { pr = document.createElement('div'); pr.id = 'print-root'; document.body.appendChild(pr); }
    pr.innerHTML = el.outerHTML; document.body.classList.add('printing-one');
    var off = function () { document.body.classList.remove('printing-one'); pr.innerHTML = ''; window.removeEventListener('afterprint', off); };
    window.addEventListener('afterprint', off);
    setTimeout(function () { window.print(); }, 50);
  }

  /* ---------- link (the quote travels inside the URL fragment, never sent to a server) ---------- */
  function b64e(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function pack(o) {
    var c = o.c || {};
    return b64e(JSON.stringify({ v: 1, i: o.id, d: o.date, l: o.lang, t: (o.items || []).map(function (x) { return [x.id, x.q, priced(x) ? +x.p : null]; }),
      c: [c.name || '', c.phone || '', c.city || '', c.delivery === 'delivery' ? 1 : 0, c.address || '', c.notes || ''], x: o.disc && +o.disc.v ? [+o.disc.v, o.disc.pct ? 1 : 0] : 0, y: +o.deliv || 0 }));
  }
  function unpack(s) {
    try {
      var j = JSON.parse(b64d(s)); if (!j || j.v !== 1 || !j.t) return null;
      var c = j.c || [];
      return { id: String(j.i || newId()), date: j.d || new Date().toISOString(), lang: j.l || 'he', items: j.t.map(function (a) { return { id: String(a[0]), q: Math.max(1, +a[1] || 1), p: a[2] == null ? null : +a[2] }; }),
        c: { name: c[0] || '', phone: c[1] || '', city: c[2] || '', delivery: c[3] ? 'delivery' : 'pickup', address: c[4] || '', notes: c[5] || '' }, disc: j.x ? { v: +j.x[0], pct: !!j.x[1] } : { v: 0, pct: false }, deliv: +j.y || 0 };
    } catch (e) { return null; }
  }
  function linkFor(o, page) {
    var pre = (S.pre && S.pre[o.lang]) != null ? S.pre[o.lang] : (K.prefix || '');
    return location.origin + (K.base || '') + '/' + pre + (page || 'order/') + '#q=' + pack(o);
  }

  /* ---------- WhatsApp texts ---------- */
  function waNumber(phone) {
    var d = String(phone || '').replace(/[^\d]/g, '');
    if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.charAt(0) === '0') d = '972' + d.slice(1);
    return d;
  }
  function wa(phone, text) { var n = waNumber(phone); return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text); }
  function quoteText(o, lang, mode, link) {
    lang = lang || o.lang || 'he';
    var t = tr(lang), T = totals(o), c = o.c || {}, L = [];
    L.push(mode === 'offer' ? fill(t.qOffer, { name: c.name || '' }).replace(/\s+,/, ',') : t.qHello, '');
    L.push(t.qTitle + ' ' + o.id);
    (o.items || []).forEach(function (x) { L.push('• ' + nameOf(x, lang) + ' | ' + (t.qRef || '') + ' ' + ltr(x.r) + (x.s ? ' | ' + ltr(x.s) : '') + ' | ' + t.qQty + ': ' + x.q + ' | ' + (priced(x) ? money(x.p * x.q, lang) : t.onRequest)); });
    L.push('');
    if (T.disc) L.push(t.qDiscount + ': ' + ltr('− ' + money(T.disc, lang)));
    if (T.deliv) L.push(t.qDelivery + ': ' + money(T.deliv, lang));
    L.push(t.qTotal + ': ' + money(T.total, lang) + (T.quote ? ' (+' + T.quote + ' ' + t.quoteItems + ')' : ''));
    if (mode !== 'offer') {
      L.push('');
      if (c.name) L.push(t.qClient + ': ' + c.name);
      if (c.phone) L.push(t.qPhone + ' ' + c.phone);
      L.push(c.delivery === 'delivery' ? t.delivery : t.pickup);
      if (c.city || c.address) L.push([c.city, c.address].filter(Boolean).join(', '));
      if (c.contact) L.push(c.contact === 'phone' ? t.qContactPhone : t.qContactWa);
      if (c.notes) L.push(t.qNotes + ': ' + c.notes);
    } else { L.push('', t.qCond); }
    if (link && link.length < 2500) L.push('', t.qLink, link);
    return L.join('\n');
  }
  function poText(o, sup, items, lang, direct) {
    var t = tr(lang || 'he'), L = [t.poHello, '', t.poTitle + ' ' + o.id + '-' + sup.code, ''];
    items.forEach(function (x) { L.push('• ' + ltr(x.r || '') + ' — ' + nameOf(x, lang) + (x.s ? ' — ' + ltr(x.s) : '') + ' — ' + t.qQty + ': ' + x.q + ' (' + t.poCode + ' ' + ltr(ourCode(x, sup.code)) + ')'); });
    if (direct && o.c) L.push('', t.poDirect + ':', partyLines(o.c, t).join(' · '));
    L.push('', t.poFoot);
    return L.join('\n');
  }

  window.KIRquote = {
    tr: tr, esc: esc, money: money, totals: totals, quoteModel: quoteModel, poModel: poModel, html: html, image: image,
    share: share, download: download, actions: actions, actionsHtml: actionsHtml, printOne: printOne,
    pack: pack, unpack: unpack, linkFor: linkFor, wa: wa, waNumber: waNumber, quoteText: quoteText, poText: poText,
    nameOf: nameOf, ourCode: ourCode, refKey: refKey, newId: newId, b64e: b64e, b64d: b64d
  };
})();
