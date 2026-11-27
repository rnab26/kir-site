/* Shop database (Supabase, schema "boutique", reached only through RPC functions).
   - Customers (no login): their quote request is recorded with boutique_submit_request.
   - Shop staff (/pro/, same email + password as the cockpit): shared history and suppliers.
   The URL and the publishable key are public by design; access is decided by the database functions.
   Config: window.KIR.db = { url, key } (data/site.json: supabaseUrl, supabaseKey). */
(function () {
  'use strict';
  var K = window.KIR || {}, C = K.db || {};
  if (!C.url || !C.key || !window.fetch) { window.KIRdb = null; return; }
  var SKEY = 'kir-pro-session-v1';
  function load() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }
  function store(s) { try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) { } }
  var sess = load(), refreshing = null;
  function headers(auth) {
    var h = { 'apikey': C.key, 'Content-Type': 'application/json' };
    if (auth && sess && sess.access_token) h.Authorization = 'Bearer ' + sess.access_token;
    return h;
  }
  function err(r, j) {
    var m = (j && (j.message || j.msg || j.error_description || j.error)) || ('HTTP ' + r.status);
    var e = new Error(m); e.status = r.status; e.code = j && j.code; return e;
  }
  function call(path, body, auth) {
    return fetch(C.url + path, { method: 'POST', headers: headers(auth), body: JSON.stringify(body || {}) })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { } if (!r.ok) throw err(r, j); return j; }); });
  }
  function keep(j) {
    sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: j.user && j.user.email };
    store(sess); return sess;
  }
  function fresh() {
    if (!sess) return Promise.resolve(null);
    if (sess.expires_at - Date.now() > 60000) return Promise.resolve(sess);
    if (!refreshing) refreshing = call('/auth/v1/token?grant_type=refresh_token', { refresh_token: sess.refresh_token }, false)
      .then(keep, function (e) { if (e.status === 400 || e.status === 401) { sess = null; store(null); } throw e; })
      .then(function (s) { refreshing = null; return s; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function rpc(name, args) {
    return fresh().then(function () { return call('/rest/v1/rpc/' + name, args || {}, true); });
  }
  window.KIRdb = {
    session: function () { return sess; },
    login: function (email, password) { return call('/auth/v1/token?grant_type=password', { email: email, password: password }, false).then(keep); },
    logout: function () { var s = sess; sess = null; store(null); if (s) fetch(C.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: C.key, Authorization: 'Bearer ' + s.access_token } }).catch(function () { }); },
    rpc: rpc,
    // customer quote request (public site): never blocks the WhatsApp message
    // keepalive: the page moves on to the quote page right after, the request must still reach the server
    submitRequest: function (o) {
      return fetch(C.url + '/rest/v1/rpc/boutique_submit_request', { method: 'POST', keepalive: true, headers: headers(false), body: JSON.stringify({ p: o }) })
        .then(function (r) { return r.ok; }, function () { return false; });
    }
  };
})();
