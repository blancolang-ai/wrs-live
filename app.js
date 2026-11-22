'use strict';
/* WRS-Live · interfaz. Los datos llegan SOLO del Worker (GET /data) cada ~10 s. */
const L = window.RD, $ = id => document.getElementById(id);
const { fmt, fmmss, fdif, fpen, ord, catShort, catCls, esc, incLabel } = L;
const API = (window.RD_API || '').replace(/\/$/, '');
const POLL_MS = 10000;
let M = null, DATA = null, VERSION = null, AT = null;

const S = { view: 'clas', cat: 'all', after: null, ti: null, tiManual: false, day: 0, pil: null, archive: null,
  favs: new Set((() => { try { return JSON.parse(localStorage.getItem('rd-favs') || '[]'); } catch { return []; } })()) };
const fcat = r => S.cat === 'all' || r.p.cat === S.cat;
const posOf = r => S.cat === 'all' ? r.pos : r.cpos;
let flashD = new Set(), lastNew = null;
const T = () => M.T, ccol = c => c === 'Rally1' ? 'r1' : 'r2';
const chg = (a, b) => { if (a == null || b == null) return ''; const d = a - b; return d > 0 ? `<small class="up">▲${d}</small>` : d < 0 ? `<small class="down">▼${-d}</small>` : `<small class="eq">=</small>`; };
const LIM_TAG = '<span class="limtag" title="Con una incidencia más, abandono">⚠ Al límite</span>';
const incidBlock = (c, t) => {
  const n = (c || 0) + (t || 0);
  return `<b class="${n ? 'inc' : ''}">${n}</b><small>${incLabel({ c: c || 0, t: t || 0 }) || '&nbsp;'}</small>`;
};
const tags = x => {
  const cs = L.incBadges('C', x.c), ts = L.incBadges('T', x.t);
  if (!cs.length && !ts.length) return '';
  const n = cs.length + ts.length;
  return '<span class="tgs' + (n > 4 ? ' many' : '') + '">' + [...cs, ...ts].map(l => '<span class="tg">' + l + '</span>').join('') + '</span>';
};
const hhmmss = iso => { try { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };

function renderHeader() {
  const d = M.data, final = L.isFinal(M);
  $('h-rally').textContent = d.rally || 'Rally';
  document.title = (d.rally || 'Rally') + ' · ' + (final ? 'Rally finalizado' : 'Directo');
  $('live').className = 'live' + (final ? ' fin' : '');
  $('live').querySelector('span').textContent = final ? 'Rally finalizado' : 'DIRECTO';
  $('h-sub').textContent = [d.venue, (final || S.archive) ? d.date : ''].filter(Boolean).join(' · ');
  renderFresh();
  const seg = $('catseg');
  if (M.CATS.length > 1) {
    seg.style.display = '';
    seg.innerHTML = `<button data-cat="all">Todos</button>` + M.CATS.map(c => `<button data-cat="${esc(c)}" class="${catCls(c).toLowerCase()}">${esc(catShort(c))}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === S.cat));
  } else seg.style.display = 'none';
}

function renderClas() {
  const sel = $('aft'); sel.innerHTML = '';
  const ct = L.curTramo(M), Tt = T();
  const timed = L.tramosWithTimes(M);
  const newest = timed.length ? timed[timed.length - 1] : ct;
  if (S.after != null && !timed.includes(S.after)) S.after = null;
  sel.add(new Option('En directo', 'live'));
  for (let i = timed.length - 1; i >= 0; i--) {
    const ti = timed[i], lab = L.tramoComplete(M, ti) ? ('Tras ' + Tt[ti].id + ' · ' + Tt[ti].name) : ('Tras ' + Tt[ti].id + ' · provisional');
    sel.add(new Option(lab, String(ti)));
  }
  const lim = S.after == null ? newest : S.after;
  sel.value = S.after == null ? 'live' : String(S.after);
  const aftLab = !timed.length ? 'Sin tiempos' : S.after == null ? 'En directo' : (L.tramoComplete(M, S.after) ? ('Tras ' + Tt[lim].id + ' · ' + Tt[lim].name) : ('Tras ' + Tt[lim].id + ' · provisional'));
  $('aft-l').textContent = aftLab;
  const seq = [null].concat(timed.slice().reverse());
  const seqI = seq.findIndex(x => x === S.after);
  $('aft-prev').disabled = !timed.length || seqI >= seq.length - 1;
  $('aft-next').disabled = !timed.length || seqI <= 0;
  if (L.isFinal(M)) { const w = L.standings(M).filter(fcat)[0]; $('ticker').innerHTML = w ? `Ganador${S.cat === 'all' ? '' : ' ' + esc(catShort(S.cat))}: <b>${esc(w.p.nombre)}</b> · ${fmt(w.tot)} · ${fmmss(w.tot)}` : ''; }
  else if (lastNew) { const p = M.byD[lastNew.d], v = p && L.raw(M, p, lastNew.ti); $('ticker').innerHTML = !v ? '' : v[0] === 999 ? `<b>${esc(p.nombre)}</b> abandona en ${Tt[lastNew.ti].id}` : `Último: <b>${Tt[lastNew.ti].id} · ${esc(p.nombre)}</b> ${fmt(v[0])}`; }
  else if (L.hasTimes(M)) { const n = M.P.filter(p => L.vis(M, ct, p.dorsal)).length; $('ticker').innerHTML = `<b>${Tt[ct].id}</b> · ${n} tiempo${n === 1 ? '' : 's'}`; }
  else $('ticker').innerHTML = 'Esperando el primer tiempo';

  // En directo, las C/T de un tramo sin tiempo cuentan en cuanto se suben (aunque ese tramo aún no tenga tiempos).
  const now = L.standings(M, lim, S.after == null ? Tt.length - 1 : lim);
  const refT = Math.min(lim, ct);
  const prev = refT > 0 ? L.standings(M, refT - 1) : null;
  const prevPos = prev ? Object.fromEntries(prev.map(r => [r.p.dorsal, posOf(r)])) : {};
  const list0 = now.filter(fcat);
  const maxN = Math.max(0, ...list0.filter(r => r.ab == null).map(r => r.n));
  const done = L.withDiffs(list0.filter(r => r.ab == null && r.n === maxN && maxN > 0));
  const pendL = list0.filter(r => r.ab == null && (r.n < maxN || maxN === 0));
  const abL = list0.filter(r => r.ab != null);
  const lead = done[0];
  const prevMap = prev ? Object.fromEntries(L.withDiffs(prev.filter(fcat)).map(r => [r.p.dorsal, r])) : {};
  const leadRow = now.find(r => r.n === maxN && r.last != null);
  const sep = pendL.length && maxN > 0 ? `<div class="grp X" style="background:#b7791f">Pendientes de ${leadRow ? Tt[leadRow.last].id : ''}${refT > 0 ? ' · posición tras ' + Tt[refT - 1].id : ''}</div>` : '';
  const list = [...done, ...pendL, ...abL], fin = L.isFinal(M);
  $('clas').innerHTML = list.map(r => {
    const isPend = pendL.includes(r), p = r.p, pr = prevMap[p.dorsal];
    const pos = isPend ? `<span style="color:#9aa2ad">${pr && pr.n ? posOf(pr) : '–'}</span>` : posOf(r);
    const ch = (!isPend && r.ab == null && prev && r.n > 0) ? chg(prevPos[p.dorsal], posOf(r)) : '';
    let l2 = '';
    if (r.ab != null) l2 = `Abandono en ${Tt[r.ab].id}`;
    else if (isPend) { const nx = r.last == null ? 0 : r.last + 1; l2 = Tt[nx] ? `<span style="color:#b7791f;font-weight:600">${Tt[nx].id} por salir</span>` : ''; }
    else if (r.last != null) { const x = L.tramoResults(M, r.last).res.find(z => z.p.dorsal === p.dorsal); l2 = `${Tt[r.last].id} <span class="${x.c || x.t ? 'inc' : ''}">${fmt(x.tm)}</span> · ${ord(S.cat === 'all' ? x.pos : x.cpos)}${tags(x)}`; }
    const accN = (r.incC || 0) + (r.incT || 0), lim3 = L.rowAtLimit(r);
    const tot = r.ab != null ? 'Ab.' : (r.n ? fmt(r.tot) : '—');
    const pen = (r.pen && r.ab == null ? `<small>pen. +${fpen(r.pen)}</small>` : '') + (fin && r.ab == null && r.n ? `<small style="color:var(--muted);font-weight:600">${fmmss(r.tot)}</small>` : '');
    const sub = x => x.d1 != null && Math.abs(x.d1 - x.dp) > 1e-6 ? `<small class="d1">1º ${fdif(x.d1)}</small>` : '';
    const dif = r.ab != null ? '' : isPend ? (pr && pr.dp != null ? `<span class="dp grey">${fdif(pr.dp)}</span>${sub(pr)}` : '<span class="dp lead">—</span>')
      : (r === lead ? `<span class="dp lead">—</span><small>Líder</small>` : (r.dp == null ? `<span class="pend">—</span>` : `<span class="dp">${fdif(r.dp)}</span>${sub(r)}`));
    return (isPend && r === pendL[0] ? sep : '') + `<div class="row ${catCls(p.cat)} ${r.ab != null ? 'ab' : ''} ${lim3 ? 'lim' : ''} ${S.favs.has(p.dorsal) ? 'fav' : ''} ${flashD.has(p.dorsal) ? 'flash' : ''}" data-d="${p.dorsal}">
      <div class="pos">${r.ab != null ? '–' : pos}${ch}</div><div class="dor">${p.dorsal}</div>
      <div style="min-width:0"><div class="nm">${esc(p.nombre)}</div><div class="nm2">${l2}</div></div>
      <div class="incid num">${accN ? incidBlock(r.incC, r.incT) : ''}${lim3 ? LIM_TAG : ''}</div>
      <div class="tot num" ${isPend ? 'style="color:#8a93a0"' : ''}>${tot}${pen}</div><div class="dif num">${dif}</div></div>`;
  }).join('');
  renderScratchRank(lim);
}

function renderScratchRank(lim) {
  const el = $('scratch-rank');
  if (!el) return;
  const groups = L.hasTimes(M) ? L.scratchRanking(M, lim).filter(g => S.cat === 'all' || g.cat === S.cat) : [];
  if (!groups.length) { el.hidden = true; el.innerHTML = ''; return; }
  const wasOpen = !!(el.querySelector('details') && el.querySelector('details').open);
  const scratchTitle = cat => cat === 'Rally1' ? 'Scratch' : (cat === 'Rally2' ? catShort(cat) : cat);
  const sum = groups.map(g => {
    const bits = g.rows.map(r => esc(r.p.nombre) + ' ' + r.n);
    return `<span class="srk-s ${catCls(g.cat)}">${esc(scratchTitle(g.cat))}</span> ${bits.join(' · ')}`;
  }).join('<span class="srk-sep">·</span>');
  const body = groups.map(g => {
    const lines = g.rows.map(r => `<div class="srk-row" data-d="${r.p.dorsal}"><span class="srk-pl">${r.place}º</span><span class="dor">${r.p.dorsal}</span><span class="nm">${esc(r.p.nombre)}</span><span class="srk-n">${r.n}</span></div>`).join('');
    const title = g.cat === 'Rally1' ? 'Scratch' : g.cat;
    return `<div class="srk-cat ${catCls(g.cat)}"><div class="srk-h">${esc(title)}</div>${lines}</div>`;
  }).join('');
  el.hidden = false;
  el.innerHTML = `<details class="srk-d"${wasOpen ? ' open' : ''}><summary><span class="srk-title">Ranking de scratch</span><span class="srk-sum">${sum}</span></summary><div class="srk-body">${body}</div></details>`;
}

function renderChips() {
  const ct = L.curTramo(M), live = L.isLive(M);
  let h = '', lastDay = -1;
  T().forEach((t, i) => {
    const d = L.dayOfSec(M, t.sec); if (d !== lastDay) { h += `<span class="dsep">${esc(M.DL[d].short)}</span>`; lastDay = d; }
    const has = M.P.some(p => L.vis(M, i, p.dorsal));
    h += `<button class="chip ${i === S.ti ? 'on' : ''} ${!has ? 'na' : ''} ${live && i === ct ? 'live' : ''}" data-ti="${i}">${esc(t.id.replace('TC', ''))}</button>`;
  });
  const c = $('chips'), keep = c.scrollLeft; c.innerHTML = h;
  const on = c.querySelector('.on');
  if (on && (on.offsetLeft < keep || on.offsetLeft + on.offsetWidth > keep + c.clientWidth)) c.scrollLeft = on.offsetLeft - c.clientWidth / 2 + on.offsetWidth / 2; else c.scrollLeft = keep;
}

function renderTramo() {
  if (S.ti == null || S.ti >= T().length) S.ti = L.curTramo(M);
  const ti = S.ti, t = T()[ti];
  renderChips();
  $('t-name').innerHTML = `${esc(t.id)} · ${esc(t.name)}${t.ps ? '<span class="ps">POWER STAGE</span>' : ''}`;
  $('t-sub').textContent = [t.km != null ? String(t.km).replace('.', ',') + ' km' : null, t.surf || null, M.SEC[t.sec].name].filter(Boolean).join(' · ');
  $('tprev').disabled = ti === 0; $('tnext').disabled = ti === T().length - 1;
  const tr = L.tramoResults(M, ti);
  const after = L.standings(M, ti), before = ti > 0 ? L.standings(M, ti - 1) : null;
  const ap = Object.fromEntries(after.map(r => [r.p.dorsal, r])), bp = before ? Object.fromEntries(before.map(r => [r.p.dorsal, r])) : {};
  const done = tr.done.filter(fcat), best = done.length ? done[0].tm : null;
  const abs = tr.res.filter(r => fcat(r) && ((r.v && r.tm === 999) || (M.ABI[r.p.dorsal] != null && M.ABI[r.p.dorsal] < ti)));
  const pend = L.expectedOrder(M, ti).map(d => tr.res.find(r => r.p.dorsal === d)).filter(r => r && !r.v && fcat(r));
  const isCur = ti === L.curTramo(M);
  let h = done.map((r, i) => {
    const p = r.p, a = ap[p.dorsal], b = bp[p.dorsal];
    const gp = posOf(a), ch = b && b.ab == null && b.n > 0 ? chg(posOf(b), gp) : '';
    return `<div class="row ${catCls(p.cat)} ${S.favs.has(p.dorsal) ? 'fav' : ''} ${flashD.has(p.dorsal) && isCur ? 'flash' : ''}" data-d="${p.dorsal}">
      <div class="pos">${S.cat === 'all' ? r.pos : r.cpos}</div><div class="dor">${p.dorsal}</div>
      <div class="nm">${esc(p.nombre)}</div>
      <div class="tm num ${r.scratch ? (p.cat === 'Rally1' ? 's1' : 's2') : ''} ${r.c || r.t ? 'inc' : ''}">${fmt(r.tm)}${tags(r)}</div>
      <div class="dif num">${i === 0 ? '<span class="dp lead">—</span>' : `<span class="dp">${fdif(r.tm - done[i - 1].tm)}</span>${i > 1 ? `<small class="d1">1º ${fdif(r.tm - best)}</small>` : ''}`}</div>
      <div class="gral">${ord(gp)}${ch}</div></div>`;
  }).join('');
  h += pend.map((r, i) => `<div class="row ${catCls(r.p.cat)}" data-d="${r.p.dorsal}"><div class="pos pend">–</div><div class="dor" style="opacity:.55">${r.p.dorsal}</div><div class="nm" style="color:#8a93a0">${esc(r.p.nombre)}</div><div class="slot" style="text-align:right;${i === 0 && isCur && done.length ? 'color:var(--accent);font-weight:700;font-style:normal' : ''}">${i === 0 && isCur && done.length ? '● en tramo' : 'por salir'}${(ir => ir ? tags(ir) : '')(L.incRaw(M, r.p, ti))}</div><div></div><div></div></div>`).join('');
  h += abs.map(r => `<div class="row ab ${catCls(r.p.cat)}" data-d="${r.p.dorsal}"><div class="pos">–</div><div class="dor">${r.p.dorsal}</div><div class="nm">${esc(r.p.nombre)}</div><div class="tm" style="color:#9aa2ad">Ab.${(r.v && M.ABI[r.p.dorsal] === ti) ? tags(r) : ''}</div><div></div><div class="gral" style="color:#9aa2ad;font-size:11px">${T()[M.ABI[r.p.dorsal]].id}</div></div>`).join('');
  $('tramo').innerHTML = h;
}

function dayBtnLabel(i, nd) {
  const dl = M.DL[i] || {};
  if (nd > 2) return (dl.short || ('D' + (i + 1))) + ' · Día ' + (i + 1);
  return dl.long || ('Día ' + (i + 1));
}
function renderSalida() {
  const nd = M.DAYS.length;
  S.day = Math.max(0, Math.min(nd - 1, S.day));
  $('daysel').innerHTML = M.DAYS.map((_, i) => `<button data-day="${i}" class="${S.day === i ? 'on' : ''}">${esc(dayBtnLabel(i, nd))}</button>`).join('');
  if (S.day === 0) {
    $('sstat').innerHTML = '<div><span class="ok">✓ Orden</span> del Excel</div>';
    const full = L.excelOrder(M);
    const list = full.filter(d => S.cat === 'all' || M.byD[d].cat === S.cat);
    let h = '<div class="grp X">orden del Excel</div>';
    list.forEach(d => {
      const p = M.byD[d];
      const num = p.ord != null && isFinite(Number(p.ord)) ? Math.round(Number(p.ord)) : (full.indexOf(d) + 1);
      h += `<div class="row ${catCls(p.cat)} ${S.favs.has(p.dorsal) ? 'fav' : ''}" data-d="${p.dorsal}"><div class="sn">${num}</div><div class="dor">${p.dorsal}</div><div class="nm">${esc(p.nombre)}</div><div class="gral" style="text-align:right;font-weight:600;color:var(--muted)">${esc(catShort(p.cat))}</div></div>`;
    });
    $('salida').innerHTML = h;
    return;
  }
  const so = L.startOrder(M, S.day), lastT = T()[so.limit].id;
  const groups = so.groups.filter(g => S.cat === 'all' || g.cat === S.cat), multi = M.CATS.length > 1;
  $('sstat').innerHTML = groups.map(g => {
    if (g.complete) return `<div><span class="ok">✓ ${multi ? esc(g.cat) : 'Orden'}</span> fijado al terminar ${lastT}</div>`;
    if (!g.n) return `<div><span class="wait">${esc(g.cat)}</span> sin pilotos en carrera</div>`;
    const miss = g.missing.map(m => esc(m.p.nombre)).join(', '), tt = [...new Set(g.missing.flatMap(m => m.m))].map(i => T()[i].id).join('/');
    return `<div><span class="wait">⏳ ${esc(g.cat)}</span> pendiente · faltan ${tt}: ${miss}</div>`;
  }).join('');
  const allDone = so.groups.every(g => g.complete || !g.n);
  const row = (r, num) => `<div class="row ${catCls(r.p.cat)} ${S.favs.has(r.p.dorsal) ? 'fav' : ''}" data-d="${r.p.dorsal}"><div class="sn">${num}</div><div class="dor">${r.p.dorsal}</div><div class="nm">${esc(r.p.nombre)}</div><div class="gral" style="text-align:right;font-weight:600;color:var(--muted)">${ord(r.cpos)} ${esc(catShort(r.p.cat))}${allDone && multi ? ` · <span style="font-weight:500">Gral. ${ord(r.pos)}</span>` : ''}</div></div>`;
  const ph = (num, cat) => `<div class="row ${catCls(cat)}"><div class="sn" style="color:#c3c8d0">${num}</div><div class="dor" style="opacity:.25"></div><div class="slot">pendiente</div><div></div></div>`;
  let h = '', n = 0;
  so.groups.forEach(g => {
    if (S.cat !== 'all' && g.cat !== S.cat) { n += g.n; return; }
    h += `<div class="grp ${catCls(g.cat)}">${multi ? esc(g.cat) + ' · ' : ''}${g.reverse ? 'orden inverso (sale primero el último)' : 'detrás, por clasificación'}</div>`;
    if (g.list.length) g.list.forEach(r => h += row(r, ++n)); else for (let i = 0; i < g.n; i++) h += ph(++n, g.cat);
  });
  const ab = so.ab.filter(fcat);
  if (ab.length) { h += `<div class="grp X">No sale</div>`; ab.forEach(r => h += `<div class="row ab ${catCls(r.p.cat)}" data-d="${r.p.dorsal}"><div class="sn">–</div><div class="dor">${r.p.dorsal}</div><div class="nm">${esc(r.p.nombre)}</div><div class="gral" style="text-align:right;color:#9aa2ad">No sale · Ab. ${T()[r.ab].id}</div></div>`); }
  $('salida').innerHTML = h;
}

/* ---------- ficha de piloto ---------- */
function spark(p) {
  const pts = [], Tt = T();
  for (let ti = 0; ti < Tt.length; ti++) { if (!L.vis(M, ti, p.dorsal)) break; const r = L.standings(M, ti).find(x => x.p.dorsal === p.dorsal); if (r.ab != null) break; pts.push(posOf(r)); }
  if (pts.length < 2) return '';
  const N = Math.max(2, S.cat === 'all' ? M.P.length : M.P.filter(x => x.cat === p.cat).length), W = 350, H = 78;
  const px = i => 14 + i * (W - 28) / Math.max(1, Tt.length - 1), py = v => 8 + (v - 1) * (H - 20) / (N - 1);
  const col = `var(--${ccol(p.cat)})`;
  const grid = [...new Set([1, Math.ceil(N / 2), N])].map(v => `<line x1="10" x2="${W - 6}" y1="${py(v)}" y2="${py(v)}" stroke="#e6e8ec"/><text x="0" y="${py(v) + 3.5}" font-size="9" fill="#8a93a0" font-family="BC">${v}º</text>`).join('');
  const path = pts.map((v, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(v).toFixed(1)).join(' ');
  const dots = pts.map((v, i) => `<circle cx="${px(i)}" cy="${py(v)}" r="2.6" fill="${col}"/>`).join('');
  const lab = [...new Set([0, 1, 2, 3, 4, 5].map(k => Math.round(k * (Tt.length - 1) / 5)))].map(i => `<text x="${px(i)}" y="${H + 4}" font-size="9" fill="#8a93a0" text-anchor="middle" font-family="BC">${esc(Tt[i].id)}</text>`).join('');
  return `<div class="sec"><div class="sh"><span>Evolución en la general</span><span>${S.cat === 'all' ? '' : esc(catShort(p.cat))}</span></div><svg viewBox="0 0 ${W} ${H + 8}" width="100%" style="display:block">${grid}<path d="${path}" fill="none" stroke="${col}" stroke-width="2.2"/>${dots}${lab}</svg></div>`;
}
function openPil(d) { if (!M.byD[d]) return; S.pil = d; renderPil(); $('app').classList.add('open'); }
function closePil() { S.pil = null; $('app').classList.remove('open'); }
function renderPil() {
  if (S.pil == null) return;
  const p = M.byD[S.pil]; if (!p) return closePil();
  const st = L.withDiffs(L.standings(M).filter(fcat));
  const idx = st.findIndex(r => r.p.dorsal === S.pil), r = st[idx];
  const ra = L.standings(M).find(x => x.p.dorsal === S.pil), fin = L.isFinal(M);
  const ninc = L.incAcc(M, p);
  const secs = M.SEC.map((s, si) => {
    let sum = 0, any = false;
    const cells = s.tramos.map(id => {
      const ti = M.tIdx[id], x = L.tramoResults(M, ti).res.find(z => z.p.dorsal === S.pil);
      if (!x.v) { const ir = L.incRaw(M, p, ti); return `<div class="cell na"><div class="ci"><span>${esc(id)}</span>${ir ? `<span>${tags(ir)}</span>` : ''}</div><div class="cv">—</div><div class="cp">&nbsp;</div></div>`; }
      if (x.tm === 999) return `<div class="cell"><div class="ci"><span>${esc(id)}</span><span>${tags(x)}</span></div><div class="cv" style="color:#9aa2ad">Ab.</div><div class="cp">&nbsp;</div></div>`;
      sum += x.tm; any = true;
      const nowP = L.generalAfter(M, S.pil, ti), prevP = ti > 0 ? L.generalAfter(M, S.pil, ti - 1) : null, dg = L.posGain(prevP, nowP);
      const gH = nowP == null ? '' : `<div class="cg">Gral. ${ord(nowP)}${dg == null ? '' : dg > 0 ? ' <span class="up">↑' + dg + '</span>' : dg < 0 ? ' <span class="down">↓' + (-dg) + '</span>' : ' <span class="eq">=</span>'}</div>`;
      return `<div class="cell ${x.scratch ? (p.cat === 'Rally1' ? 's1' : 's2') : ''}"><div class="ci"><span>${esc(id)}</span><span>${tags(x)}</span></div><div class="cv num ${x.c || x.t ? 'inc' : ''}">${fmt(x.tm)}</div><div class="cp">${ord(x.pos)} · ${esc(catShort(p.cat))} ${ord(x.cpos)}</div>${gH}</div>`;
    }).join('');
    const pen = p.pen[si] ? `<span class="pen">+${fpen(p.pen[si])}</span>` : '';
    return `<div class="sec"><div class="sh"><span>${esc(s.name)}</span></div><div class="cells">${cells}</div><div class="suma"><span>Suma</span><span class="sv"><b class="num">${any ? fmt(Math.round(sum * 1000) / 1000) : '—'}</b>${pen}</span></div></div>`;
  }).join('');
  const pens = p.pen.map((v, i) => v ? `+${fpen(v)} en ${esc(M.SEC[i].name)}` : null).filter(Boolean);
  const cc = ccol(p.cat);
  $('sheet').innerHTML = `<div class="grab"></div>
   <div class="ph ${catCls(p.cat)}" style="--cc:var(--${cc})"><div class="dor">${p.dorsal}</div>
     <div class="who"><b>${esc(p.nombre)}</b><span>${esc((p.coche || '').replace(/\/.*$/, ''))} · <b style="color:var(--${cc}-ink);font-size:12.5px;display:inline;font-family:Barlow">${esc(p.cat)}</b></span></div>
     <div class="nav2"><button class="star ${S.favs.has(p.dorsal) ? 'on' : ''}" id="pstar" aria-label="Favorito">★</button><button class="arrow" id="pprev" aria-label="Anterior" ${idx <= 0 ? 'disabled' : ''}>‹</button><button class="arrow" id="pnext" aria-label="Siguiente" ${idx < 0 || idx >= st.length - 1 ? 'disabled' : ''}>›</button></div></div>
   <div class="kpis">
     <div><label>Posición</label><b>${ra.ab != null ? 'Ab.' : ra.n ? ord(ra.pos) : '—'}</b><small>${ra.ab != null ? T()[ra.ab].id : ra.n ? esc(catShort(p.cat)) + ' ' + ord(ra.cpos) : '&nbsp;'}</small></div>
     <div><label>Total</label><b class="num">${ra.ab != null || !ra.n ? '—' : fmt(ra.tot)}</b>${fin && ra.ab == null && ra.n ? `<small>${fmmss(ra.tot)}</small>` : ''}<small style="color:var(--red)">${ra.pen && ra.ab == null ? 'pen. +' + fpen(ra.pen) : (fin ? '' : '&nbsp;')}</small></div>
     <div><label>Dif. ant.</label><b class="num dpk">${r && r.dp != null ? fdif(r.dp) : '—'}</b>${r && r.d1 != null && Math.abs(r.d1 - r.dp) > 1e-6 ? `<small class="d1">1º ${fdif(r.d1)}</small>` : '<small>&nbsp;</small>'}</div>
     <div class="${L.atLimit(ninc.c, ninc.t, ra && ra.ab) ? 'klim' : ''}"><label>Incid.</label>${incidBlock(ninc.c, ninc.t)}${L.atLimit(ninc.c, ninc.t, ra && ra.ab) ? LIM_TAG : ''}</div>
   </div>
   <div class="secs">${secs}${spark(p)}${pens.length ? `<div class="pnote">Penalización: ${pens.join(', ')}</div>` : ''}</div>`;
  $('pstar').onclick = () => { S.favs.has(p.dorsal) ? S.favs.delete(p.dorsal) : S.favs.add(p.dorsal); try { localStorage.setItem('rd-favs', JSON.stringify([...S.favs])); } catch {} renderAll(); };
  $('pprev').onclick = () => { if (idx > 0) { S.pil = st[idx - 1].p.dorsal; renderPil(); } };
  $('pnext').onclick = () => { if (idx >= 0 && idx < st.length - 1) { S.pil = st[idx + 1].p.dorsal; renderPil(); } };
}

function renderAll() {
  if (!M) return;
  renderHeader();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + S.view));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  renderClas(); renderTramo(); renderSalida(); renderPil();
}

/* ---------- eventos ---------- */
$('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.view = b.dataset.v; closePil(); renderAll(); };
$('catseg').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.cat = b.dataset.cat; renderAll(); };
$('aft').onchange = e => { const v = e.target.value; S.after = (v === 'live') ? null : +v; renderClas(); };
function stepAfter(dir) {
  if (!M) return;
  const timed = L.tramosWithTimes(M), seq = [null].concat(timed.slice().reverse());
  const i = seq.findIndex(x => x === S.after) + dir;
  if (i < 0 || i >= seq.length) return;
  S.after = seq[i]; renderClas();
}
$('aft-prev').onclick = () => stepAfter(1);
$('aft-next').onclick = () => stepAfter(-1);
$('chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.ti = +b.dataset.ti; S.tiManual = S.ti !== L.curTramo(M); renderTramo(); };
$('tprev').onclick = () => { if (S.ti > 0) { S.ti--; S.tiManual = S.ti !== L.curTramo(M); renderTramo(); } };
$('tnext').onclick = () => { if (S.ti < T().length - 1) { S.ti++; S.tiManual = S.ti !== L.curTramo(M); renderTramo(); } };
$('daysel').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.day = +b.dataset.day; S.dayManual = true; renderSalida(); };
['clas', 'tramo', 'salida'].forEach(id => $(id).addEventListener('click', e => { const r = e.target.closest('.row[data-d]'); if (r) openPil(+r.dataset.d); }));
$('scratch-rank').addEventListener('click', e => { const r = e.target.closest('.srk-row[data-d]'); if (r) openPil(+r.dataset.d); });
$('scrim').onclick = closePil;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePil(); });
function swipe(el, left, right, down) {
  let x0, y0; el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) { dx < 0 ? left() : right(); } else if (down && dy > 90 && Math.abs(dx) < 40) down(); x0 = null; }, { passive: true });
}
swipe($('tramo'), () => $('tnext').click(), () => $('tprev').click());
swipe($('sheet'), () => $('pnext') && $('pnext').click(), () => $('pprev') && $('pprev').click(), closePil);
function toast(msg, fn) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); t.onclick = () => { t.classList.remove('on'); fn && fn(); }; clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 6000); }

/* ---------- datos en directo ---------- */
function applyData(j) {
  const app = $('app'); app.classList.remove('loading');
  if (S.archive) return;
  if (!j || !j.live || !j.data) { M = null; DATA = null; VERSION = j ? j.version : null; AT = null; app.classList.add('noRally'); closePil(); renderFresh(); return; }
  app.classList.remove('noRally');
  if (j.version === VERSION && M) { AT = j.updatedAt || j.at; renderHeader(); return; }
  const firstLoad = !M, sameRally = DATA && DATA.rally === j.data.rally && DATA.tramos.length === j.data.tramos.length;
  const ch = sameRally ? L.changes(DATA, j.data) : [];
  if (!sameRally) { S.ti = null; S.tiManual = false; S.after = null; lastNew = null; if (!M || !j.data.cats.includes(S.cat)) S.cat = 'all'; }
  DATA = j.data; VERSION = j.version; AT = j.updatedAt || j.at; M = L.model(DATA);
  const nw = ch.filter(c => c.ti != null);
  if (nw.length) lastNew = nw.reduce((a, b) => (b.ti > a.ti ? b : a));
  flashD = new Set(ch.map(c => c.d));
  const cur = L.curTramo(M);
  if (!S.tiManual || firstLoad) S.ti = cur;
  else if (nw.some(c => c.ti !== S.ti)) { const tgt = lastNew.ti; toast(`Nuevo tiempo en ${M.T[tgt].id} · ver`, () => { S.ti = tgt; S.tiManual = false; S.view = 'tramo'; renderAll(); }); }
  // día del orden de salida: el próximo que va a empezar (salvo que el aficionado haya elegido otro)
  if (!sameRally) S.dayManual = false;
  if (!S.dayManual) { const dc = L.dayOfSec(M, M.T[cur].sec), lastOfDay = M.DAYS[dc].secs.at(-1) === M.T[cur].sec && M.T.filter(t => t.sec === M.T[cur].sec).at(-1) === M.T[cur]; S.day = Math.max(0, Math.min(M.DAYS.length - 1, dc + (lastOfDay && L.tramoComplete(M, cur) ? 1 : 0))); }
  renderAll();
  if (flashD.size) setTimeout(() => { flashD = new Set(); document.querySelectorAll('.row.flash').forEach(r => r.classList.remove('flash')); }, 2600);
}
let timer = null, failures = 0;
const BUILD = window.RD_BUILD || '';
let lastInteract = Date.now();
['pointerdown', 'keydown', 'touchstart', 'scroll', 'change'].forEach(ev => document.addEventListener(ev, () => { lastInteract = Date.now(); }, { passive: true, capture: true }));
async function checkBuild() {
  if (!BUILD) return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.version || j.version === BUILD) return;
    const busy = $('app').classList.contains('open') || (Date.now() - lastInteract) < 15000;
    if (busy) return;
    try { if (sessionStorage.getItem('rd-build-reload') === j.version) return; sessionStorage.setItem('rd-build-reload', j.version); } catch (e) {}
    const u = new URL(location.href);
    u.searchParams.set('v', j.version);
    location.replace(u.toString());
  } catch (e) {}
}
function renderFresh() {
  const el = $('fresh'); if (!el) return;
  if ($('app').classList.contains('offline')) { el.textContent = 'Sin conexión'; el.className = 'fresh stale'; return; }
  if (S.archive || !AT) { el.textContent = ''; el.className = 'fresh'; return; }
  const ms = Date.now() - new Date(AT).getTime(), final = M && L.isFinal(M);
  if (!isFinite(ms)) { el.textContent = ''; el.className = 'fresh'; return; }
  const min = Math.max(0, Math.round(ms / 60000));
  let text, cls = 'fresh';
  if (!final && min >= 15) { text = 'Sin datos nuevos desde hace ' + min + ' min'; cls += ' stale'; }
  else if (ms < 45000) text = 'Última actualización hace un momento';
  else { text = 'Última actualización hace ' + min + ' min'; if (!final && min >= 5) cls += ' amber'; }
  el.textContent = text; el.className = cls;
}
async function poll() {
  clearTimeout(timer);
  if (S.archive) { checkBuild(); renderFresh(); if (!document.hidden) timer = setTimeout(poll, POLL_MS); return; }
  try {
    const r = await fetch(API + '/data', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    applyData(await r.json()); failures = 0; $('app').classList.remove('offline');
  } catch (e) {
    failures++; if (failures >= 2 || !M) $('app').classList.add('offline');
    if ($('app').classList.contains('loading') && failures >= 2) { $('app').classList.remove('loading'); $('app').classList.add('noRally'); }
  }
  renderFresh();
  checkBuild();
  if (!document.hidden) timer = setTimeout(poll, failures ? Math.min(30000, POLL_MS * (1 + failures)) : POLL_MS);
}
function hashSlug() {
  const m = (location.hash || '').match(/^#\/rally\/([a-z0-9-]+)$/i);
  return m ? m[1].toLowerCase() : null;
}
function showArchBanner(name, date) {
  const ban = $('arch-ban');
  $('arch-name').textContent = name || 'Rally';
  $('arch-date').textContent = date ? '· ' + date : '';
  ban.hidden = false;
  $('app').classList.add('archived');
}
function hideArchBanner() { $('arch-ban').hidden = true; $('app').classList.remove('archived'); }
async function openArchive(slug) {
  closePil();
  try {
    const r = await fetch(API + '/archive/' + encodeURIComponent(slug), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !j.data) throw new Error('sin datos');
    S.archive = slug; S.after = null; S.tiManual = false; S.ti = null; lastNew = null;
    DATA = j.data; M = L.model(DATA); AT = j.updatedAt || j.at || null;
    $('app').classList.remove('loading', 'noRally', 'offline');
    showArchBanner(j.data.rally, j.data.date);
    closeHist();
    renderAll();
    if ((location.hash || '') !== '#/rally/' + slug) location.hash = '#/rally/' + slug;
  } catch (e) {
    toast('No encuentro ese rally');
    if (S.archive === slug) leaveArchive();
    else {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      if (!M) poll();
    }
  }
}
function leaveArchive() {
  if (!S.archive && !hashSlug()) { hideArchBanner(); return; }
  S.archive = null; hideArchBanner(); closePil();
  M = null; DATA = null; VERSION = null; AT = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('app').classList.add('loading');
  poll();
}
async function syncRoute() {
  const slug = hashSlug();
  if (slug) { if (S.archive !== slug) await openArchive(slug); }
  else if (S.archive) leaveArchive();
}
function closeHist() { $('hist').classList.remove('on'); }
function groupHist(list) {
  const map = new Map();
  for (const e of list) {
    const y = e.season == null ? null : e.season;
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(e);
  }
  const keys = [...map.keys()].sort((a, b) => (b == null ? -1 : b) - (a == null ? -1 : a));
  return keys.map(y => ({
    season: y,
    items: map.get(y).slice().sort((a, b) => {
      const da = a.dateKey || '', db = b.dateKey || '';
      if (db !== da) return db < da ? -1 : db > da ? 1 : 0;
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    })
  }));
}
function podRow(cat, rows) {
  if (!rows || !rows.length) return '';
  const cls = cat === 'Rally2' ? 'R2' : (cat === 'Rally1' ? 'R1' : 'X');
  const lab = cat === 'Rally1' ? 'R1' : cat === 'Rally2' ? 'R2' : esc(cat);
  const ps = rows.map(p => `<span class="pod-p"><i>${esc(String(p.dorsal))}</i> ${esc(p.nombre || '')}</span>`).join('');
  return `<div class="pod-row ${cls}"><span class="pod-lab">${lab}</span>${ps}</div>`;
}
function renderHistList(list) {
  const groups = groupHist(list);
  const nowY = new Date().getFullYear();
  const openY = groups.some(g => g.season === nowY) ? nowY : groups[0].season;
  return groups.map(g => {
    const title = g.season != null ? 'Temporada ' + g.season : 'Sin temporada';
    const open = g.season === openY ? ' open' : '';
    const items = g.items.map(e => {
      const pods = e.podiums || {};
      const rows = [];
      if (pods.Rally1) rows.push(podRow('Rally1', pods.Rally1));
      if (pods.Rally2) rows.push(podRow('Rally2', pods.Rally2));
      Object.keys(pods).forEach(k => { if (k !== 'Rally1' && k !== 'Rally2') rows.push(podRow(k, pods[k])); });
      return `<button type="button" class="hist-item" data-slug="${esc(e.slug)}"><b>${esc(e.name || e.slug)}</b><small>${esc(e.date || '')}</small><div class="pod">${rows.join('')}</div></button>`;
    }).join('');
    return `<details class="hist-season"${open}><summary>${esc(title)}</summary>${items}</details>`;
  }).join('');
}
async function openHist() {
  const box = $('hist-list');
  box.innerHTML = '<div class="empty-h">Cargando…</div>';
  $('hist').classList.add('on');
  try {
    const r = await fetch(API + '/archive', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const list = (j && j.rallies) || [];
    if (!list.length) { box.innerHTML = '<div class="empty-h">Todavía no hay rallies terminados en el histórico.</div>'; return; }
    box.innerHTML = renderHistList(list);
  } catch (e) {
    box.innerHTML = '<div class="empty-h">No se ha podido cargar el histórico. Comprueba la conexión.</div>';
  }
}
$('hist-btn').onclick = openHist;
$('empty-hist').onclick = openHist;
$('hist-close').onclick = closeHist;
$('hist-list').onclick = e => { const b = e.target.closest('[data-slug]'); if (b) openArchive(b.dataset.slug); };
$('arch-back').onclick = leaveArchive;
function maybeA2hs() {
  const el = $('a2hs'); if (!el) return;
  try { if (localStorage.getItem('rd-a2hs') === '1') return; } catch (e) { return; }
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Android/.test(ua);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (ios && safari && !standalone) {
    el.classList.add('on');
    $('a2hs-x').onclick = () => { el.classList.remove('on'); try { localStorage.setItem('rd-a2hs', '1'); } catch (e) {} };
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); else clearTimeout(timer); });
window.addEventListener('online', poll);
window.addEventListener('hashchange', () => { syncRoute(); });
window.__rd = { applyData, S, get M() { return M; }, BUILD, openArchive, leaveArchive };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=' + (BUILD || '0'), { updateViaCache: 'none' }).catch(() => {});
maybeA2hs();
setInterval(renderFresh, 15000);
if (hashSlug()) syncRoute(); else poll();
