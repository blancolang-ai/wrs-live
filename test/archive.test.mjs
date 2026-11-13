// El criterio de «rally finalizado» y el ganador del histórico coinciden con la lógica de la página.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isRallyFinal, winnerSummary, archiveSlug, isValidSlug } from '../worker/src/archive.js';
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
