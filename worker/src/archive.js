// Historial de rallies finalizados (solo campos públicos). Usado por el Worker.
function incCount(n) { n = Math.round(Number(n)); return isFinite(n) && n > 0 ? n : 0; }
function abandonIndex(T, p) {
  let acc = 0;
  for (let ti = 0; ti < T.length; ti++) {
    const v = p.t && p.t[T[ti].id]; if (!v) continue;
    acc += incCount(v[1]) + incCount(v[2]);
    if (v[0] === 999 || acc >= 4) return ti;
  }
  return null;
}
function vis(T, p, ti, ABI) {
  if (ABI != null && ti > ABI) return false;
  return !!(p.t && p.t[T[ti].id]);
}
export function isRallyFinal(data) {
  const T = (data && data.tramos) || [], P = (data && data.pilotos) || [];
  if (!T.length || !P.some(p => p.t && Object.keys(p.t).length)) return false;
  const ABI = Object.fromEntries(P.map(p => [p.dorsal, abandonIndex(T, p)]));
  for (let ti = 0; ti < T.length; ti++) {
    let any = false;
    for (const p of P) {
      const ab = ABI[p.dorsal];
      if (ab != null && ab < ti) continue;
      if (!vis(T, p, ti, ab)) return false;
      any = true;
    }
    if (!any) return false;
  }
  return true;
}
function incN(v) { return incCount(v && v[1]) + incCount(v && v[2]); }
export function winnerSummary(data) {
  const T = (data && data.tramos) || [], P = (data && data.pilotos) || [];
  const rows = P.map(p => {
    let n = 0, tot = 0, ab = null, pen = 0;
    const secTouched = new Set();
    const abi = abandonIndex(T, p);
    for (let ti = 0; ti < T.length; ti++) {
      const v = p.t && p.t[T[ti].id]; if (!v) continue;
      if (abi != null && ti > abi) break;
      if (abi != null && ti === abi) { ab = ti; break; }
      if (v[0] === 999) { ab = ti; break; }
      n++; tot += v[0]; if (T[ti].sec != null) secTouched.add(T[ti].sec);
    }
    const pens = p.pen || [];
    secTouched.forEach(s => { pen += pens[s] || 0; });
    tot = Math.round((tot + pen) * 1000) / 1000;
    return { p, n, tot, ab };
  });
  const act = rows.filter(r => r.ab == null).sort((a, b) => b.n - a.n || a.tot - b.tot || a.p.dorsal - b.p.dorsal);
  const w = act.find(r => r.n);
  return w ? { dorsal: w.p.dorsal, nombre: w.p.nombre, tot: w.tot } : null;
}
export function archiveSlug(data) {
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const a = fold((data && data.rally) || 'rally') || 'rally';
  const b = fold(data && data.date);
  return b ? a + '-' + b : a;
}
export function isValidSlug(s) { return typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 120; }
export function indexEntry(slug, data, winner, at) {
  return { slug, name: (data && data.rally) || 'Rally', date: (data && data.date) || '', winner, at };
}
