// Pruebas de la lógica de la página con datos SINTÉTICOS.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module'; import { synth } from './fixture.mjs';
const L = createRequire(import.meta.url)('../logic.js');
const sum = (d, p, n) => Object.entries(p.t).slice(0, n).reduce((a, [, v]) => a + v[0], 0);

test('clasificación: ordena por total con penalizaciones y calcula Dif. ant. / Dif. 1º', () => {
  const d = synth({ upTo: 4 }), m = L.model(d);
  const st = L.withDiffs(L.standings(m));
  const exp = d.pilotos.map(p => ({ dor: p.dorsal, tot: Math.round((sum(d, p, 4) + (p.pen[0] + p.pen[1])) * 1000) / 1000 })).sort((a, b) => a.tot - b.tot || a.dor - b.dor);
  assert.deepEqual(st.map(r => r.p.dorsal), exp.map(e => e.dor));
  st.forEach((r, i) => { assert.equal(r.tot, exp[i].tot); if (i) { assert.equal(r.dp, Math.round((exp[i].tot - exp[i - 1].tot) * 1000) / 1000); assert.equal(r.d1, Math.round((exp[i].tot - exp[0].tot) * 1000) / 1000); } });
  assert.equal(st[0].dp, null); assert.equal(st.find(r => r.p.dorsal === 3).pen, 10);
  // por categoría
  assert.deepEqual(st.filter(r => r.p.cat === 'Rally2').map(r => r.cpos), [1, 2]);
});
test('durante un tramo: los que tienen tiempo se ordenan delante; los pendientes sin diferencia', () => {
  const d = synth({ upTo: 3 }); delete d.pilotos[0].t.TC3; delete d.pilotos[4].t.TC3;
  const m = L.model(d), st = L.standings(m);
  assert.deepEqual(st.slice(0, 3).map(r => r.n), [3, 3, 3]); assert.deepEqual(st.slice(3).map(r => r.n), [2, 2]);
  assert.equal(L.isLive(m), true); assert.equal(L.tramoComplete(m, 2), false); assert.equal(L.tramoComplete(m, 1), true); assert.equal(L.curTramo(m), 2);
  const wd = L.withDiffs(st); assert.equal(wd[3].dp, null);
  assert.deepEqual(L.expectedOrder(m, 2).filter(x => !d.pilotos.find(p => p.dorsal === x).t.TC3), [1, 12]);
});
test('scratch por categoría y C/T conservados', () => {
  const d = synth({ upTo: 2 }), m = L.model(d), tr = L.tramoResults(m, 1);
  const s = tr.res.filter(r => r.scratch).map(r => r.p.cat).sort();
  assert.deepEqual(s, ['Rally1', 'Rally2']);
  const r1best = Math.min(...d.pilotos.filter(p => p.cat === 'Rally1').map(p => p.t.TC2[0]));
  assert.equal(tr.best.Rally1, r1best);
  assert.equal(tr.res.find(r => r.p.dorsal === 2).c, 1);
});
test('abandono (999): al final, fuera de diferencias y «No sale» en el orden de salida', () => {
  const d = synth({ upTo: 8, abandon: { d: 2, ti: 2 } }), m = L.model(d), st = L.standings(m);
  assert.equal(st.at(-1).p.dorsal, 2); assert.equal(st.at(-1).ab, 2);
  assert.equal(L.tramoComplete(m, 5), true);
  const so = L.startOrder(m, 1); assert.deepEqual(so.ab.map(r => r.p.dorsal), [2]);
  assert.ok(!so.groups.flatMap(g => g.list).some(r => r.p.dorsal === 2));
  assert.equal(L.fmt(999), 'Ab.');
});
test('orden de salida: Rally1 inverso, Rally2 normal; R1 se fija antes que R2', () => {
  const d = synth({ upTo: 4 }); delete d.pilotos[3].t.TC4; // falta un Rally2 en la última sección del día 1
  let m = L.model(d), so = L.startOrder(m, 1);
  const g1 = so.groups[0], g2 = so.groups[1];
  assert.equal(g1.cat, 'Rally1'); assert.equal(g1.complete, true); assert.equal(g2.complete, false); assert.deepEqual(g2.list, []);
  assert.deepEqual(g2.missing.map(x => x.p.dorsal), [11]);
  const r1 = L.standings(m, 3).filter(r => r.p.cat === 'Rally1').map(r => r.p.dorsal);
  assert.deepEqual(g1.list.map(r => r.p.dorsal), [...r1].reverse());
  m = L.model(synth({ upTo: 4 })); so = L.startOrder(m, 1);
  assert.equal(so.groups[1].complete, true);
  assert.deepEqual(so.groups[1].list.map(r => r.p.dorsal), L.standings(m, 3).filter(r => r.p.cat === 'Rally2').map(r => r.p.dorsal));
  // sin tiempos del día: pendiente
  assert.equal(L.startOrder(L.model(synth({ upTo: 2 })), 1).groups[0].complete, false);
});
test('categoría única (formato antiguo): orden inverso para todos', () => {
  const d = synth({ upTo: 4 }); d.pilotos.forEach(p => p.cat = 'Rally1'); d.cats = ['Rally1'];
  const m = L.model(d), so = L.startOrder(m, 1);
  assert.equal(so.groups.length, 1); assert.deepEqual(so.groups[0].list.map(r => r.p.dorsal), L.standings(m, 3).map(r => r.p.dorsal).reverse());
});
test('final: todos los tramos completos', () => {
  const m = L.model(synth()); assert.equal(L.isFinal(m), true); assert.equal(L.isLive(m), false);
  assert.equal(L.isFinal(L.model(synth({ upTo: 7 }))), false);
});
test('formato en segundos y minutos', () => {
  assert.equal(L.fmt(154.6), '154,6\u00a0"'); assert.equal(L.fmt(2935.561), '2.935,561\u00a0"'); assert.equal(L.fmmss(2935.561), '48\'55,561\u00a0"');
  assert.equal(L.fmmss(65.5), '1\'05,5\u00a0"'); assert.equal(L.fdif(0), '±0,0\u00a0"'); assert.equal(L.fdif(1.25), '+1,250\u00a0"'); assert.equal(L.fpen(10), '10\u00a0"'); assert.equal(L.fpen(2.5), '2,5\u00a0"');
  assert.equal(L.fmt(null), '—'); assert.equal(L.fmt(12.5, { u: false }), '12,5');
  assert.equal(L.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
test('cambios entre versiones: detecta tiempos nuevos y corregidos', () => {
  const a = synth({ upTo: 2 }), b = synth({ upTo: 3 }); b.pilotos[0].t.TC1 = [1, 0, 0];
  const ch = L.changes(a, b);
  assert.equal(ch.filter(c => c.ti === 2).length, 5); assert.ok(ch.some(c => c.d === 1 && c.ti === 0));
  assert.deepEqual(L.changes(a, a), []);
});

test('incBadges, etiqueta compacta e incidencias acumuladas hasta el límite', () => {
  assert.deepEqual(L.incBadges('C', 3), ['C', 'C', 'C']);
  assert.deepEqual(L.incBadges('T', 0), []);
  assert.deepEqual(L.incBadges('T', '2'), ['T', 'T']);
  assert.equal(L.incLabel({ c: 2, t: 1 }), 'C 2 · T 1');
  assert.equal(L.incLabel({ c: 0, t: 0 }), '');
  assert.equal(L.incLabel({ c: 2, t: 0 }), 'C 2');
  const d = synth({ upTo: 4 }), m = L.model(d);
  const st = L.standings(m, 3);
  const bravo = st.find(r => r.p.dorsal === 2);
  assert.equal(bravo.incC, 1); assert.equal(bravo.incT, 0);
  assert.deepEqual(L.incAcc(m, m.byD[2], 3), { c: 1, t: 0 });
  assert.deepEqual(L.incAcc(m, m.byD[2], 0), { c: 0, t: 0 });
  st.filter(r => r.p.dorsal !== 2).forEach(r => { assert.equal(r.incC, 0); assert.equal(r.incT, 0); });
});
test('ranking de scratch: top 2 por categoría, empates compartiendo puesto y vacío sin tiempos', () => {
  assert.deepEqual(L.scratchRanking(L.model(synth({ upTo: 0 }))), []);
  const d = synth({ upTo: 4 }), m = L.model(d);
  const n = {};
  for (let ti = 0; ti <= 3; ti++) {
    assert.equal(L.tramoComplete(m, ti), true);
    L.tramoResults(m, ti).res.forEach(r => { if (r.scratch) n[r.p.dorsal] = (n[r.p.dorsal] || 0) + 1; });
  }
  const rk = L.scratchRanking(m, 3);
  assert.ok(rk.length >= 1);
  rk.forEach(g => {
    assert.ok(g.rows.length <= 3);
    g.rows.forEach(r => assert.equal(r.n, n[r.p.dorsal]));
    const first = g.rows.filter(r => r.place === 1);
    assert.ok(first.length >= 1);
    first.forEach(r => assert.equal(r.n, first[0].n));
    const second = g.rows.filter(r => r.place === 2);
    if (second.length) assert.ok(second[0].n < first[0].n);
  });
  const d2 = synth({ upTo: 2 });
  d2.pilotos.filter(p => p.cat === 'Rally1').forEach(p => { Object.keys(p.t).forEach(k => { p.t[k] = [100, 0, 0]; }); });
  const r1 = L.scratchRanking(L.model(d2), 1).find(g => g.cat === 'Rally1');
  assert.equal(r1.rows.length, 3);
  assert.ok(r1.rows.every(r => r.place === 1 && r.n === 2));
});

test('scratch en directo: se marca el mejor de la categoría sin esperar a que terminen todos, y se mueve si alguien lo bate', () => {
  const d = synth({ upTo: 1 });
  d.pilotos.forEach(p => { if (p.dorsal !== 1 && p.dorsal !== 11) delete p.t.TC1; });
  const m = L.model(d);
  assert.equal(L.tramoComplete(m, 0), false);
  const tr = L.tramoResults(m, 0);
  assert.equal(tr.res.find(r => r.p.dorsal === 1).scratch, true);
  assert.equal(tr.res.find(r => r.p.dorsal === 11).scratch, true);
  assert.equal(tr.res.find(r => r.p.dorsal === 2).v, false);
  assert.equal(tr.res.find(r => r.p.dorsal === 2).scratch, false);
  const d2 = synth({ upTo: 1 });
  d2.pilotos.forEach(p => { if (p.dorsal !== 1 && p.dorsal !== 2 && p.dorsal !== 11) delete p.t.TC1; });
  const alfa = d2.pilotos.find(p => p.dorsal === 1).t.TC1[0];
  d2.pilotos.find(p => p.dorsal === 2).t.TC1[0] = alfa - 1;
  const m2 = L.model(d2), tr2 = L.tramoResults(m2, 0);
  assert.equal(L.tramoComplete(m2, 0), false);
  assert.equal(tr2.res.find(r => r.p.dorsal === 2).scratch, true);
  assert.equal(tr2.res.find(r => r.p.dorsal === 1).scratch, false);
  const r1 = L.scratchRanking(m2, 0).find(g => g.cat === 'Rally1');
  assert.ok(r1.rows.some(r => r.p.dorsal === 2 && r.n === 1));
  assert.ok(!r1.rows.some(r => r.p.dorsal === 1));
});

test('4 incidencias acumuladas: abandono en ese tramo, se conservan los tiempos anteriores y se ignoran el de ese tramo y los posteriores', () => {
  const d = synth({ upTo: 6 });
  const p = d.pilotos.find(x => x.dorsal === 1);
  // 1+1+1 en TC1–TC3; en TC4 llega a 4 (1 C) con tiempo, y aún escribe TC5
  p.t.TC1 = [110, 1, 0];
  p.t.TC2 = [111, 1, 0];
  p.t.TC3 = [112, 1, 0];
  p.t.TC4 = [113, 1, 0];
  p.t.TC5 = [114, 0, 0];
  p.t.TC6 = [115, 0, 0];
  const m = L.model(d);
  assert.equal(m.ABI[1], 3);
  assert.deepEqual(L.raw(m, p, 3), [999, 1, 0]);
  assert.equal(L.raw(m, p, 4), null);
  assert.equal(L.vis(m, 4, 1), false);
  const st = L.standings(m);
  const r = st.find(x => x.p.dorsal === 1);
  assert.equal(r.ab, 3);
  assert.equal(r.n, 3);
  assert.equal(r.tot, 110 + 111 + 112);
  assert.equal(r.last, 2);
  assert.equal(r.incC, 4); assert.equal(r.incT, 0);
  assert.equal(st.at(-1).p.dorsal, 1);
  assert.equal(L.withDiffs(st).find(x => x.p.dorsal === 1).dp, null);
  assert.deepEqual(L.incAcc(m, p), { c: 4, t: 0 });
  assert.deepEqual(L.incAcc(m, p, 2), { c: 3, t: 0 });
  const tr = L.tramoResults(m, 3).res.find(x => x.p.dorsal === 1);
  assert.equal(tr.tm, 999); assert.equal(tr.c, 1); assert.equal(tr.scratch, false);
  assert.ok(!L.tramoResults(m, 3).done.some(x => x.p.dorsal === 1));
  assert.equal(L.tramoComplete(m, 4), true);
  const so = L.startOrder(m, 1);
  assert.deepEqual(so.ab.map(x => x.p.dorsal), [1]);
  assert.ok(!so.groups.flatMap(g => g.list).some(x => x.p.dorsal === 1));
  assert.ok(L.expectedOrder(m, 3).includes(1));
  assert.ok(!L.expectedOrder(m, 4).includes(1));
});

test('4 incidencias en un salto (C+T) y mezcla con abandono 999: no se abandona con 3', () => {
  const d = synth({ upTo: 4 });
  const p2 = d.pilotos.find(x => x.dorsal === 2);
  p2.t.TC1 = [101, 2, 1]; // 3, sigue en carrera
  p2.t.TC2 = [102, 0, 2]; // llega a 5 en TC2
  const m = L.model(d);
  assert.equal(m.ABI[2], 1);
  const r = L.standings(m).find(x => x.p.dorsal === 2);
  assert.equal(r.ab, 1); assert.equal(r.n, 1); assert.equal(r.tot, 101);
  assert.equal(r.incC, 2); assert.equal(r.incT, 3);
  const p3 = d.pilotos.find(x => x.dorsal === 3);
  // 3 incidencias y luego un 999 clásico
  p3.t.TC1 = [103, 1, 1];
  p3.t.TC2 = [104, 1, 0];
  p3.t.TC3 = [999, 0, 0];
  const m2 = L.model(d);
  assert.equal(m2.ABI[3], 2);
  assert.equal(L.standings(m2).find(x => x.p.dorsal === 3).ab, 2);
  assert.deepEqual(L.incAcc(m2, m2.byD[3]), { c: 2, t: 1 });
  // 4 C en el primer tramo: abandono inmediato, sin tiempo
  const p12 = d.pilotos.find(x => x.dorsal === 12);
  p12.t.TC1 = [50, 3, 1];
  const m3 = L.model(d);
  const r12 = L.standings(m3).find(x => x.p.dorsal === 12);
  assert.equal(r12.ab, 0); assert.equal(r12.n, 0); assert.equal(r12.incC, 3); assert.equal(r12.incT, 1);
  const tr0 = L.tramoResults(m3, 0).res.find(x => x.p.dorsal === 12);
  assert.equal(tr0.tm, 999); assert.equal(tr0.c, 3); assert.equal(tr0.t, 1); assert.equal(tr0.scratch, false);
});

test('tramosWithTimes incluye tramos incompletos; la clasificación hasta ese tramo deja pendientes a quienes no tienen tiempo', () => {
  const d = synth({ upTo: 3 });
  delete d.pilotos[0].t.TC3; delete d.pilotos[4].t.TC3;
  const m = L.model(d);
  assert.deepEqual(L.tramosWithTimes(m), [0, 1, 2]);
  assert.equal(L.tramoComplete(m, 2), false);
  assert.equal(L.tramoComplete(m, 1), true);
  const st = L.standings(m, 2);
  assert.deepEqual(st.slice(0, 3).map(r => r.n), [3, 3, 3]);
  assert.deepEqual(st.slice(3).map(r => r.n), [2, 2]);
  const st2 = L.standings(m, 1);
  assert.ok(st2.every(r => r.n === 2 && r.ab == null));
  const empty = synth({ upTo: 0 });
  empty.pilotos.forEach(p => { p.t = {}; });
  assert.deepEqual(L.tramosWithTimes(L.model(empty)), []);
  assert.deepEqual(L.tramosWithTimes(L.model(synth({ upTo: 2 }))), [0, 1]);
});

test('posición general tras cada tramo y puestos ganados o perdidos', () => {
  const d = synth({ upTo: 3 }), m = L.model(d);
  const after1 = Object.fromEntries(d.pilotos.map(p => [p.dorsal, L.generalAfter(m, p.dorsal, 0)]));
  const st1 = L.standings(m, 0).filter(r => r.ab == null && r.n);
  st1.forEach((r, i) => assert.equal(after1[r.p.dorsal], i + 1));
  const pFirst = st1[0].p.dorsal, pLast = st1.at(-1).p.dorsal;
  // mismo orden en el 2º tramo salvo que movamos a alguien
  const g0 = L.generalAfter(m, pFirst, 0), g1 = L.generalAfter(m, pFirst, 1);
  assert.equal(L.posGain(g0, g1), g0 - g1);
  assert.equal(L.posGain(3, 1), 2);
  assert.equal(L.posGain(1, 3), -2);
  assert.equal(L.posGain(2, 2), 0);
  assert.equal(L.posGain(null, 1), null);
  const four = synth({ upTo: 4 });
  const q = four.pilotos.find(x => x.dorsal === 12);
  q.t.TC1 = [50, 3, 1]; // 4 incidencias en TC1: abandono, sin posición
  const m2 = L.model(four);
  assert.equal(L.generalAfter(m2, 12, 0), null);
  assert.equal(L.generalAfter(m2, 12, 1), null);
});
test('al límite: exactamente 3 incidencias acumuladas (sin abandono), también en «Ver tras…»', () => {
  const d = synth({ upTo: 6 });
  const P = Object.fromEntries(d.pilotos.map(p => [p.dorsal, p]));
  P[1].t.TC1[1] = 1;                       // Alfa: 1 C en TC1…
  P[1].t.TC3[2] = 2;                       // …y 2 T en TC3 → 3 tras TC3
  P[11].t.TC2[1] = 2; P[11].t.TC4[2] = 2;  // Delta: 2 tras TC2, 4 en TC4 → abandono
  P[12].t.TC1[1] = 3;                      // Eco: 3 desde TC1
  const m = L.model(d);
  const lim = ti => L.standings(m, ti).filter(L.rowAtLimit).map(r => r.p.dorsal).sort((a, b) => a - b);
  assert.deepEqual(lim(0), [12]);          // tras TC1: solo Eco
  assert.deepEqual(lim(1), [12]);          // tras TC2: Delta lleva 2, Bravo 1
  assert.deepEqual(lim(2), [1, 12]);       // tras TC3: Alfa llega a 3
  assert.deepEqual(lim(5), [1, 12]);       // Delta abandona en TC4 con 4: no está «al límite», es Ab.
  const delta = L.standings(m, 5).find(r => r.p.dorsal === 11);
  assert.equal(delta.ab, 3); assert.equal(L.rowAtLimit(delta), false);
  assert.equal(L.atLimit(2, 1, null), true); assert.equal(L.atLimit(3, 0, 4), false); assert.equal(L.atLimit(2, 0, null), false); assert.equal(L.atLimit(4, 0, null), false);
  assert.equal(L.ABANDON_INC, 4);
});
test('scratch absoluto: si el mejor tiempo del tramo es de un R2, no hay scratch R1; si es de un R1, R2 conserva el suyo; empate, los dos', () => {
  const sc = tr => tr.res.filter(r => r.scratch).map(r => r.p.dorsal).sort((a, b) => a - b);
  // TC1: Eco (R2) hace el mejor absoluto → solo Eco
  const d = synth({ upTo: 3 }); const P = Object.fromEntries(d.pilotos.map(p => [p.dorsal, p]));
  P[12].t.TC1[0] = 95;
  // TC2: Alfa (R1) es el mejor absoluto → Alfa y el mejor R2 (como antes)
  // TC3: empate absoluto Bravo (R1) = Delta (R2) → los dos
  P[2].t.TC3[0] = 90; P[11].t.TC3[0] = 90;
  const m = L.model(d);
  assert.deepEqual(sc(L.tramoResults(m, 0)), [12]);
  assert.equal(L.tramoResults(m, 0).best.Rally1, Math.min(P[1].t.TC1[0], P[2].t.TC1[0], P[3].t.TC1[0])); // el mejor R1 sigue calculándose…
  assert.equal(L.tramoResults(m, 0).scr.Rally1, null);    // …pero no es scratch
  const tc2 = L.tramoResults(m, 1); const r2best = Math.min(P[11].t.TC2[0], P[12].t.TC2[0]);
  assert.deepEqual(sc(tc2).length, 2); assert.equal(tc2.res.find(r => r.scratch && r.p.cat === 'Rally2').tm, r2best);
  assert.deepEqual(sc(L.tramoResults(m, 2)), [2, 11]);
  // ranking de scratch: Alfa pierde TC1; Eco lo gana
  const n = cat => Object.fromEntries((L.scratchRanking(m, 2).find(g => g.cat === cat) || { rows: [] }).rows.map(r => [r.p.dorsal, r.n]));
  // cuenta esperada: R1 solo en TC2 (el mejor R1 de TC2) y TC3 (Bravo, empate absoluto)
  const r1tc2 = L.tramoResults(m, 1).res.filter(r => r.scratch && r.p.cat === 'Rally1').map(r => r.p.dorsal);
  const exp1 = {}; [...r1tc2, 2].forEach(d => exp1[d] = (exp1[d] || 0) + 1);
  assert.deepEqual(n('Rally1'), exp1);
  assert.equal(n('Rally2')[12] >= 1, true);
  // «Ver tras TC1»: solo Eco tiene scratch
  assert.deepEqual(L.scratchRanking(m, 0).map(g => g.cat), ['Rally2']);
});
test('scratch absoluto en directo (provisional): R1 sin scratch mientras un R2 tenga el mejor absoluto, hasta que un R1 lo bata', () => {
  const d = synth({ upTo: 1 }); const P = Object.fromEntries(d.pilotos.map(p => [p.dorsal, p]));
  // solo han pasado Delta (R2, 99) y Alfa (R1, 100)
  d.pilotos.forEach(p => { if (p.dorsal !== 1 && p.dorsal !== 11) delete p.t.TC1; });
  P[11].t.TC1[0] = 99;
  let m = L.model(d);
  assert.equal(L.tramoComplete(m, 0), false);
  assert.deepEqual(L.tramoResults(m, 0).res.filter(r => r.scratch).map(r => r.p.dorsal), [11]);
  // llega Bravo (R1) con 98: bate a Delta → Bravo scratch R1 y Delta conserva el de R2
  const d2 = JSON.parse(JSON.stringify(d)); d2.pilotos.find(p => p.dorsal === 2).t.TC1 = [98, 0, 0];
  m = L.model(d2);
  assert.deepEqual(L.tramoResults(m, 0).res.filter(r => r.scratch).map(r => r.p.dorsal).sort((a, b) => a - b), [2, 11]);
});
