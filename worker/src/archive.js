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
const MES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
function pad2(n) { return String(n).padStart(2, '0'); }
function foldMon(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
}
export function seasonOf(data, at) {
  if (data && Number.isFinite(data.season) && data.season >= 2000 && data.season <= 2100) return Math.round(data.season);
  const key = dateKeyOf(data, at, true);
  if (key) return parseInt(key.slice(0, 4), 10);
  if (at) {
    const y = new Date(at).getUTCFullYear();
    if (y >= 2000 && y <= 2100) return y;
  }
  return null;
}
// skipSeason avoids recursion when dateKeyOf needs a year.
export function dateKeyOf(data, at, skipSeason) {
  const raw = String((data && data.date) || '').trim();
  const m = /^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)(?:\s+(\d{4}))?/.exec(raw);
  let year = null, month = null, day = null;
  if (m) {
    day = parseInt(m[1], 10);
    month = MES[foldMon(m[2])] || null;
    if (m[3]) year = parseInt(m[3], 10);
  }
  if (year == null && !skipSeason && data && Number.isFinite(data.season) && data.season >= 2000 && data.season <= 2100) {
    year = Math.round(data.season);
  }
  if (year == null && at) {
    const y = new Date(at).getUTCFullYear();
    if (y >= 2000 && y <= 2100) year = y;
  }
  if (year && month && day) return year + '-' + pad2(month) + '-' + pad2(day);
  if (at && /^\d{4}-\d{2}-\d{2}/.test(String(at))) return String(at).slice(0, 10);
  return null;
}
export function podiumSummary(data) {
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
  const act = rows.filter(r => r.ab == null && r.n).sort((a, b) => b.n - a.n || a.tot - b.tot || a.p.dorsal - b.p.dorsal);
  const cats = (data && Array.isArray(data.cats) && data.cats.length) ? data.cats : ['Rally1'];
  const out = {};
  for (const cat of cats) {
    out[cat] = act.filter(r => (r.p.cat || 'Rally1') === cat).slice(0, 3).map(r => ({ dorsal: r.p.dorsal, nombre: r.p.nombre }));
  }
  if (!out.Rally1) out.Rally1 = [];
  if (!out.Rally2 && (cats.includes('Rally2') || P.some(p => p.cat === 'Rally2'))) out.Rally2 = [];
  return out;
}
export function indexEntry(slug, data, winner, at) {
  return {
    slug, name: (data && data.rally) || 'Rally', date: (data && data.date) || '',
    season: seasonOf(data, at), dateKey: dateKeyOf(data, at),
    winner: winner || null, podiums: podiumSummary(data), at
  };
}
export function needsHydrate(e) {
  return !e || e.season == null || !e.dateKey || !e.podiums || typeof e.podiums !== 'object';
}
export function publicIndex(e) {
  return {
    slug: e.slug, name: e.name, date: e.date || '',
    season: e.season == null ? null : e.season,
    dateKey: e.dateKey || null,
    winner: e.winner || null,
    podiums: e.podiums || { Rally1: [], Rally2: [] }
  };
}
export function sortIndex(list) {
  return list.slice().sort((a, b) => {
    const sa = a.season == null ? -1 : a.season;
    const sb = b.season == null ? -1 : b.season;
    if (sb !== sa) return sb - sa;
    const da = a.dateKey || '';
    const db = b.dateKey || '';
    if (db !== da) return db < da ? -1 : db > da ? 1 : 0;
    return String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });
}
