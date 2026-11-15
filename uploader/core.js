/* WRS-Live · bucle del programa de subida (independiente de la plataforma).
 * io: { now(), sleep(s), log(msg), stat(path)->{m,z}|null, open(path)->getXml, post(json)->{status,body}, hash(s) } */
var UploaderCore = (function () {
  'use strict';
  function hhmmss(d) { function z(n) { return (n < 10 ? '0' : '') + n; } return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
  function badName(p) { var b = String(p).split('/').pop(); return /^~\$/.test(b) || /^\./.test(b) || !/\.xlsx$/i.test(b); }
  function summary(r) {
    var d = r.data, last = null;
    d.tramos.forEach(function (t) { if (d.pilotos.some(function (p) { return p.t[t.id] && p.t[t.id][0] !== 0; })) last = t.id; });
    return d.rally + ' · ' + (last ? 'hasta ' + last : 'sin tiempos') + ' · ' + r.times + ' tiempos · ' + d.pilotos.length + ' pilotos';
  }
  function newState(path) { return { path: path, seen: null, stableAt: null, sentHash: null, pending: null, warnKey: null, nextTry: 0, lastErr: null, uploads: 0, sheet: null }; }
  /* una vuelta del bucle; devuelve los segundos a esperar */
  function step(st, io, parser) {
    var now = io.now();
    var s = io.stat(st.path);
    if (!s) { if (st.lastErr !== 'nofile') io.log('⚠ No encuentro el Excel: ' + st.path + ' (¿lo has movido o renombrado?)'); st.lastErr = 'nofile'; return 3; }
    var sig = s.m + ':' + s.z;
    if (sig !== st.seen) { st.seen = sig; st.stableAt = now + 1500; return 1; }       // espera a que Excel termine de guardar
    if (st.stableAt !== null && now >= st.stableAt) {
      st.stableAt = null;
      try {
        var r = parser.parse(io.open(st.path));
        if (r.sheet && r.sheet !== st.sheet) { io.log('📄 Usando la pestaña «' + r.sheet + '»'); st.sheet = r.sheet; }
        var wk = r.warnings.join('\n');
        if (wk !== st.warnKey) { st.warnKey = wk; r.warnings.forEach(function (w) { io.log('  ⚠ ' + w); }); }
        var json = JSON.stringify(r.data), h = io.hash(json);
        if (h !== st.sentHash) { st.pending = { json: json, hash: h, sum: summary(r) }; st.nextTry = 0; }
        else if (!st.pending) io.log('Guardado sin cambios en los tiempos (' + hhmmss(new Date(now)) + ')');
      } catch (e) {
        io.log('⚠ No puedo leer el Excel (' + (e && e.message || e) + '). Lo reintento al volver a guardar.');
        st.lastErr = 'parse';
        if (/zip|unzip|End-of-central|cannot find/i.test(String(e && e.message))) { st.seen = null; }
      }
    }
    if (st.pending && now >= st.nextTry) {
      var res = null, err = null;
      try { res = io.post(st.pending.json); } catch (e) { err = e; }
      if (res && res.status === 200) {
        st.sentHash = st.pending.hash; st.uploads++;
        io.log('✅ Subido ' + hhmmss(new Date(now)) + ' · ' + st.pending.sum);
        st.pending = null; st.lastErr = null;
      } else if (res && (res.status === 401 || res.status === 403)) {
        io.log('⛔ El servidor rechaza la clave (clave.txt). No se reintenta hasta volver a guardar. ' + (res.body || ''));
        st.pending = null; st.lastErr = 'key';
      } else if (res && (res.status === 413 || res.status === 422 || res.status === 400)) {
        io.log('⛔ El servidor no acepta los datos (' + res.status + '): ' + (res.body || '') + '. Comprueba que cada piloto tiene un dorsal numérico único y que los tiempos, C, T y penalizaciones son números. Corrige el Excel y vuelve a guardar.');
        st.pending = null; st.lastErr = 'data';
      } else {
        var why = err ? 'sin conexión' : 'error del servidor ' + (res && res.status);
        io.log('… ' + why + ' (' + hhmmss(new Date(now)) + '). Reintento en 5 s; no cierres esta ventana.');
        st.nextTry = now + 5000; st.lastErr = 'net';
      }
    }
    return st.pending ? 1 : 2;
  }
  return { step: step, newState: newState, badName: badName, hhmmss: hhmmss };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UploaderCore;
