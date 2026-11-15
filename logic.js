/* WRS-Live · lógica pura (clasificación, diferencias, scratch, orden de salida, formato).
 * Sin DOM: la usan la página (window.RD) y las pruebas (Node). */
(function (root) {
  'use strict';
  const R1 = 'Rally1';
  function model(data) {
    const T = data.tramos, P = data.pilotos, SEC = data.sections;
    const ndays = SEC.length ? Math.max(...SEC.map(s => s.day)) + 1 : 1;
    const DAYS = Array.from({ length: ndays }, (_, d) => ({ secs: SEC.map((s, i) => s.day === d ? i : -1).filter(i => i >= 0) }));
    const CATS = data.cats && data.cats.length ? data.cats : [R1];
    const byD = Object.fromEntries(P.map(p => [p.dorsal, p]));
    const tIdx = Object.fromEntries(T.map((t, i) => [t.id, i]));
    const ABI = Object.fromEntries(P.map(p => [p.dorsal, abandonIndex(T, p)]));
    const DL = data.dayLabels && data.dayLabels.length === ndays ? data.dayLabels : DAYS.map((d, i) => ({ short: 'D' + (i + 1), long: 'Día ' + (i + 1) }));
    return { data, T, P, SEC, DAYS, CATS, byD, tIdx, ABI, DL, cache: new Map() };
  }
  /* Primer tramo (en orden) con 999 o en el que C+T acumulados llegan a 4. */
  function abandonIndex(T, p) {
    let acc = 0;
    for (let ti = 0; ti < T.length; ti++) {
      const v = p.t[T[ti].id]; if (!v) continue;
      acc += incCount(v[1]) + incCount(v[2]);
      if (v[0] === 999 || acc >= 4) return ti;
    }
    return null;
  }
  function raw(m, p, ti) {
    const v = p.t[m.T[ti].id] || null;
    if (!v) return null;
    const ab = m.ABI[p.dorsal];
    if (ab != null && ti > ab) return null;
    if (ab != null && ti === ab) return [999, incCount(v[1]), incCount(v[2])];
    return v;
  }
  const vis = (m, ti, d) => !!raw(m, m.byD[d], ti);
  const dayOfSec = (m, s) => m.SEC[s].day;
  function incCount(n) { n = Math.round(Number(n)); return isFinite(n) && n > 0 ? n : 0; }
  function incBadges(letter, n) { const k = incCount(n), a = []; for (let i = 0; i < k; i++) a.push(letter); return a; }
  /* C y T acumulados hasta el tramo «limit» (misma regla que el total de tiempos). */
  function incAcc(m, p, limit = m.T.length - 1) {
    let c = 0, t = 0;
    for (let ti = 0; ti <= limit; ti++) {
      const v = raw(m, p, ti); if (!v) continue;
      c += incCount(v[1]); t += incCount(v[2]);
      if (v[0] === 999) break;
    }
    return { c, t };
  }
  /* Posición general tras el tramo ti (null si no corre o ya abandonó). */
  function generalAfter(m, dorsal, ti) {
    const r = standings(m, ti).find(x => x.p.dorsal === dorsal);
    if (!r || r.ab != null || !r.n) return null;
    return r.pos;
  }
  function posGain(prev, now) {
    if (prev == null || now == null) return null;
    return prev - now;
  }
  function incLabel(acc) {
    const parts = [];
    if (acc.c > 0) parts.push('C ' + acc.c);
    if (acc.t > 0) parts.push('T ' + acc.t);
    return parts.join(' · ');
  }
  /* Los 2 primeros puestos de scratch por categoría (empates comparten puesto; máx. 3 líneas).
     Misma regla que el sombreado: el mejor tiempo de la categoría en cada tramo, también en directo (sin esperar a que terminen todos). */
  function scratchRanking(m, limit = m.T.length - 1) {
    const n = {};
    for (let ti = 0; ti <= limit; ti++) {
      tramoResults(m, ti).res.forEach(r => { if (r.scratch) n[r.p.dorsal] = (n[r.p.dorsal] || 0) + 1; });
    }
    return m.CATS.map(cat => {
      const pil = m.P.filter(p => p.cat === cat).map(p => ({ p, n: n[p.dorsal] || 0 })).filter(x => x.n > 0)
        .sort((a, b) => b.n - a.n || a.p.dorsal - b.p.dorsal);
      const rows = [];
      let place = 0, prev = null;
      for (const x of pil) {
        if (x.n !== prev) { if (rows.length && place >= 2) break; place = rows.length + 1; prev = x.n; }
        if (rows.length >= 3) break;
        rows.push({ place, n: x.n, p: x.p });
      }
      return { cat, rows };
    }).filter(g => g.rows.length);
  }
  // ¿todos los pilotos tienen tiempo en el tramo? (los abandonados antes no cuentan)
  function tramoComplete(m, ti) {
    let any = false;
    for (const p of m.P) {
      const ab = m.ABI[p.dorsal];
      if (ab != null && ab < ti) continue;
      if (!vis(m, ti, p.dorsal)) return false;
      any = true;
    }
    return any;
  }
  function curTramo(m) { for (let ti = m.T.length - 1; ti >= 0; ti--) if (m.P.some(p => vis(m, ti, p.dorsal))) return ti; return 0; }
  const hasTimes = m => m.P.some(p => Object.keys(p.t).length > 0);
  /* Índices de tramos con al menos un tiempo (o abandono), en orden de carrera. */
  function tramosWithTimes(m) {
    const out = [];
    for (let ti = 0; ti < m.T.length; ti++) if (m.P.some(p => vis(m, ti, p.dorsal))) out.push(ti);
    return out;
  }
  const isFinal = m => m.T.length > 0 && hasTimes(m) && m.T.every((t, ti) => tramoComplete(m, ti));
  const isLive = m => hasTimes(m) && !tramoComplete(m, curTramo(m));

  /* clasificación hasta el tramo «limit» (incluido) */
  function standings(m, limit = m.T.length - 1) {
    const key = 'st' + limit; if (m.cache.has(key)) return m.cache.get(key).map(r => ({ ...r }));
    const rows = m.P.map(p => {
      let n = 0, tot = 0, ab = null, last = null, pen = 0, incC = 0, incT = 0;
      const secTouched = new Set();
      for (let ti = 0; ti <= limit; ti++) {
        const v = raw(m, p, ti); if (!v) continue;
        incC += incCount(v[1]); incT += incCount(v[2]);
        if (v[0] === 999) { if (ab == null) ab = ti; continue; }
        if (ab != null) continue;
        n++; tot += v[0]; last = ti; secTouched.add(m.T[ti].sec);
      }
      secTouched.forEach(s => pen += p.pen[s] || 0);
      tot = Math.round((tot + pen) * 1000) / 1000;
      return { p, n, tot, ab, last, pen, incC, incT };
    });
    const act = rows.filter(r => r.ab == null).sort((a, b) => b.n - a.n || a.tot - b.tot || a.p.dorsal - b.p.dorsal);
    const abs = rows.filter(r => r.ab != null).sort((a, b) => b.ab - a.ab || a.p.dorsal - b.p.dorsal);
    const all = [...act, ...abs];
    all.forEach((r, i) => r.pos = i + 1);
    m.CATS.forEach(c => all.filter(r => r.p.cat === c).forEach((r, i) => r.cpos = i + 1));
    m.cache.set(key, all);
    return all.map(r => ({ ...r }));
  }
  /* diferencias con el anterior (dp) y con el primero (d1), solo entre quienes han hecho los mismos tramos */
  function withDiffs(list) {
    const lead = list[0];
    list.forEach((r, i) => {
      r.d1 = null; r.dp = null;
      if (r.ab != null || !lead) return;
      if (r.n === lead.n && i > 0) r.d1 = Math.round((r.tot - lead.tot) * 1000) / 1000;
      const prev = list[i - 1];
      if (prev && prev.ab == null && prev.n === r.n) r.dp = Math.round((r.tot - prev.tot) * 1000) / 1000;
    });
    return list;
  }
  /* resultados de un tramo: posiciones, scratch por categoría */
  function tramoResults(m, ti) {
    const key = 'tr' + ti; if (m.cache.has(key)) return m.cache.get(key);
    const res = m.P.map(p => { const v = raw(m, p, ti); return { p, v: !!v, tm: v ? v[0] : null, c: v ? v[1] : 0, t: v ? v[2] : 0 }; });
    const best = {};
    m.CATS.forEach(cat => { const ok = res.filter(r => r.p.cat === cat && r.v && r.tm !== 999); best[cat] = ok.length ? Math.min(...ok.map(r => r.tm)) : null; });
    const done = res.filter(r => r.v && r.tm !== 999).sort((a, b) => a.tm - b.tm || a.p.dorsal - b.p.dorsal);
    done.forEach((r, i) => r.pos = i + 1);
    m.CATS.forEach(c => done.filter(r => r.p.cat === c).forEach((r, i) => r.cpos = i + 1));
    res.forEach(r => r.scratch = r.v && r.tm !== 999 && r.tm === best[r.p.cat]);
    const out = { res, done, best }; m.cache.set(key, out); return out;
  }
  /* orden de salida del día «day» (1 = 2º día…). Se fija por categoría cuando todos sus pilotos
     en carrera tienen tiempo en todos los tramos de la última sección del día anterior.
     Rally1 (o categoría única): orden inverso. Las demás: detrás, por clasificación. */
  function startOrder(m, day) {
    const lastSec = m.DAYS[day - 1].secs.at(-1);
    const secT = m.T.map((t, i) => i).filter(i => m.T[i].sec === lastSec);
    const limit = secT.length ? secT.at(-1) : m.T.length - 1;
    const st = standings(m, limit);
    const groups = m.CATS.map(cat => {
      const pil = st.filter(r => r.p.cat === cat), active = pil.filter(r => r.ab == null);
      const missing = [];
      active.forEach(r => { const mm = secT.filter(ti => !vis(m, ti, r.p.dorsal)); if (mm.length) missing.push({ p: r.p, m: mm }); });
      const complete = missing.length === 0 && active.length > 0;
      const reverse = cat === R1;
      return { cat, reverse, complete, missing, n: active.length, list: complete ? (reverse ? [...active].reverse() : active) : [] };
    }).sort((a, b) => (b.reverse - a.reverse) || (a.cat < b.cat ? -1 : 1));
    return { groups, ab: st.filter(r => r.ab != null), limit, secT, all: st };
  }
  /* orden en que se espera que salgan al tramo (para listar los pendientes) */
  function expectedOrder(m, ti) {
    const day = dayOfSec(m, m.T[ti].sec);
    let order;
    if (day === 0) order = [...m.P].sort((a, b) => (a.cat > b.cat ? 1 : a.cat < b.cat ? -1 : 0) || a.dorsal - b.dorsal).map(p => p.dorsal);
    else {
      const so = startOrder(m, day);
      order = [];
      so.groups.forEach(g => (g.complete ? g.list.map(r => r.p.dorsal) : m.P.filter(p => p.cat === g.cat).sort((a, b) => a.dorsal - b.dorsal).map(p => p.dorsal)).forEach(d => order.push(d)));
      m.P.forEach(p => { if (!order.includes(p.dorsal)) order.push(p.dorsal); });
    }
    return order.filter(d => m.ABI[d] == null || ti <= m.ABI[d]);
  }
  /* qué ha cambiado entre dos versiones de datos: [{d, ti}] de tiempos nuevos o corregidos */
  function changes(oldData, newData) {
    if (!oldData) return [];
    const om = Object.fromEntries(oldData.pilotos.map(p => [p.dorsal, p])), out = [];
    newData.pilotos.forEach(p => {
      const o = om[p.dorsal];
      newData.tramos.forEach((t, ti) => { const a = o && o.t[t.id], b = p.t[t.id]; if (b && JSON.stringify(a) !== JSON.stringify(b)) out.push({ d: p.dorsal, ti }); });
      if (o && JSON.stringify(o.pen) !== JSON.stringify(p.pen)) out.push({ d: p.dorsal, ti: null });
    });
    return out;
  }
  /* ---------- formato (todo en segundos; los tiempos llevan el símbolo " de segundos) ---------- */
  const UNIT = '\u00a0"';
  function decs(s) { const r = Math.round(s * 1000) / 1000; return Math.abs(r - Math.round(r * 10) / 10) > 0.0005 ? 3 : 1; }
  function fmt(s, o) {
    if (s == null) return '—'; if (s === 999) return 'Ab.';
    const d = o && o.d != null ? o.d : decs(s);
    const [i, f] = Math.abs(s).toFixed(d).split('.');
    return (s < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (f ? ',' + f : '') + (o && o.u === false ? '' : UNIT);
  }
  function fmmss(s) { const d = decs(s), mm = Math.floor(s / 60 + 1e-9), r = s - mm * 60; return mm + "'" + r.toFixed(d).replace('.', ',').padStart(3 + d, '0') + UNIT; }
  const fdif = s => s == null ? '' : (s < 0.0005 ? '±0,0' + UNIT : '+' + fmt(s));
  const fpen = s => (Math.abs(s - Math.round(s)) < 1e-9 ? String(Math.round(s)) + UNIT : fmt(s));
  const ord = n => n + 'º';
  const catShort = c => c === R1 ? 'R1' : c === 'Rally2' ? 'R2' : String(c).slice(0, 3);
  const catCls = c => c === R1 ? 'R1' : 'R2';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const api = { model, vis, raw, abandonIndex, tramoComplete, curTramo, hasTimes, tramosWithTimes, isFinal, isLive, standings, withDiffs, tramoResults, startOrder, expectedOrder, changes, incCount, incBadges, incAcc, incLabel, generalAfter, posGain, scratchRanking, decs, fmt, fmmss, fdif, fpen, ord, catShort, catCls, esc, dayOfSec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RD = api;
})(typeof window !== 'undefined' ? window : globalThis);
