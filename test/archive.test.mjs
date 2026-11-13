// El criterio de «rally finalizado» y el ganador del histórico coinciden con la lógica de la página.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isRallyFinal, winnerSummary, archiveSlug, isValidSlug, podiumSummary, seasonOf, dateKeyOf, indexEntry, needsHydrate, sortIndex, publicIndex } from '../worker/src/archive.js';
import { synth } from './fixture.mjs';
const L = createRequire(import.meta.url)('../logic.js');

test('archiveSlug: nombre y fecha, sin acentos', () => {
  assert.equal(archiveSlug({ rally: 'Rally Japón', date: '26 abr' }), 'rally-japon-26-abr');
  assert.equal(archiveSlug({ rally: 'Rally Prueba', date: '1 ene' }), 'rally-prueba-1-ene');
  assert.equal(archiveSlug({ rally: 'Rally' }), 'rally');
  assert.equal(isValidSlug('rally-japon-26-abr'), true);
  assert.equal(isValidSlug('../x'), false);
  assert.equal(isValidSlug(''), false);
});

test('isRallyFinal coincide con L.isFinal (completo, a medio y con abandono por 4 incidencias)', () => {
  const full = synth();
  assert.equal(L.isFinal(L.model(full)), true);
  assert.equal(isRallyFinal(full), true);
  const mid = synth({ upTo: 3 });
  assert.equal(L.isFinal(L.model(mid)), false);
  assert.equal(isRallyFinal(mid), false);
  const ab = synth({ upTo: 8, abandon: { d: 2, ti: 2 } });
  assert.equal(isRallyFinal(ab), L.isFinal(L.model(ab)));
  const four = synth();
  const p = four.pilotos.find(x => x.dorsal === 1);
  Object.keys(p.t).forEach((k, i) => { if (i < 4) p.t[k][1] = 1; });
  assert.equal(isRallyFinal(four), L.isFinal(L.model(four)));
});

test('winnerSummary coincide con el primero de la clasificación (sin abandonos)', () => {
  const d = synth();
  const w = winnerSummary(d);
  const st = L.standings(L.model(d)).find(r => r.ab == null && r.n);
  assert.ok(w && st);
  assert.equal(w.dorsal, st.p.dorsal);
  assert.equal(w.nombre, st.p.nombre);
  assert.equal(w.tot, st.tot);
  const mid = synth({ upTo: 3 });
  assert.equal(winnerSummary(mid).dorsal, L.standings(L.model(mid)).find(r => r.ab == null).p.dorsal);
});

test('podium R1/R2: top 3 de cada categoría, sin abandonos, coherente con la clasificación', () => {
  const d = synth();
  const pod = podiumSummary(d);
  const st = L.standings(L.model(d));
  const r1 = st.filter(r => r.p.cat === 'Rally1' && r.ab == null && r.n).slice(0, 3).map(r => r.p.dorsal);
  const r2 = st.filter(r => r.p.cat === 'Rally2' && r.ab == null && r.n).slice(0, 3).map(r => r.p.dorsal);
  assert.deepEqual(pod.Rally1.map(p => p.dorsal), r1);
  assert.deepEqual(pod.Rally2.map(p => p.dorsal), r2);
  assert.equal(pod.Rally1.length, 3);
  assert.equal(pod.Rally2.length, 2);
  assert.ok(pod.Rally1.every(p => p.nombre && p.dorsal));
  const ab = synth({ abandon: { d: 1, ti: 2 } });
  const podAb = podiumSummary(ab);
  assert.ok(!podAb.Rally1.some(p => p.dorsal === 1));
  const four = synth();
  const p = four.pilotos.find(x => x.dorsal === 1);
  Object.keys(p.t).forEach((k, i) => { if (i < 4) p.t[k][1] = 1; });
  assert.ok(!podiumSummary(four).Rally1.some(x => x.dorsal === 1));
});

test('seasonOf y dateKeyOf: campo season, fecha «d mes» y reserva del año de at', () => {
  assert.equal(seasonOf({ season: 2026, date: '26 abr' }), 2026);
  assert.equal(dateKeyOf({ season: 2026, date: '26 abr' }), '2026-04-26');
  assert.equal(dateKeyOf({ date: '5 feb 2025' }), '2025-02-05');
  assert.equal(seasonOf({ date: '5 feb 2025' }), 2025);
  assert.equal(dateKeyOf({ date: '1 ene' }, '2024-06-01T12:00:00.000Z'), '2024-01-01');
  assert.equal(seasonOf({ date: '1 ene' }, '2024-06-01T12:00:00.000Z'), 2024);
  assert.equal(seasonOf({}), null);
});

test('indexEntry guarda temporada y podiums; las entradas antiguas se recalcan; se agrupa por temporada y fecha desc', () => {
  const d = synth();
  d.rally = 'Rally Gamma'; d.date = '5 feb'; d.season = 2026;
  const e = indexEntry('rally-gamma-5-feb', d, winnerSummary(d), '2026-02-06T10:00:00.000Z');
  assert.equal(e.season, 2026);
  assert.equal(e.dateKey, '2026-02-05');
  assert.equal(e.podiums.Rally1[0].dorsal, winnerSummary(d).dorsal);
  assert.equal(needsHydrate({ slug: e.slug, name: e.name, date: e.date, winner: e.winner, at: e.at }), true);
  assert.equal(needsHydrate(e), false);
  const a = indexEntry('rally-alfa-10-ene', Object.assign(synth(), { rally: 'Rally Alfa', date: '10 ene', season: 2026 }), null, '2026-01-11T00:00:00.000Z');
  const b = indexEntry('rally-beta-20-dic', Object.assign(synth(), { rally: 'Rally Beta', date: '20 dic', season: 2025 }), null, '2025-12-21T00:00:00.000Z');
  const sorted = sortIndex([b, a, e]);
  assert.deepEqual(sorted.map(x => x.slug), ['rally-gamma-5-feb', 'rally-alfa-10-ene', 'rally-beta-20-dic']);
  const pub = publicIndex(e);
  assert.equal(pub.at, undefined);
  assert.equal(pub.season, 2026);
  assert.ok(pub.podiums.Rally1.length);
});
