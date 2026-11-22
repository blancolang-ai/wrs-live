// Pruebas del Worker con «wrangler dev» local y una clave de prueba (no la real).
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { spawn } from 'node:child_process'; import { synth } from '../../test/fixture.mjs';
const PORT = 8817, API = `http://127.0.0.1:${PORT}`, KEY = 'clave-de-prueba-' + Math.random().toString(36).slice(2), ORIGIN = 'https://blancolang-ai.github.io';
let wr; const wait = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  wr = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '/tmp/rd-wr-test-' + Date.now(), '--var', 'UPLOAD_KEY:' + KEY],
    { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(API + '/')).ok) return; } catch {} await wait(500); }
  throw new Error('wrangler dev no arrancó');
});
after(() => wr && wr.kill('SIGTERM'));
const up = (body, key = KEY) => fetch(API + '/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Upload-Key': key } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (h = {}) => fetch(API + '/data', { headers: { Origin: ORIGIN, ...h } });

test('sin datos: live=false', async () => { const r = await get(); assert.equal(r.status, 200); assert.equal((await r.json()).live, false); assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN); });
test('subida rechazada sin clave o con clave mala', async () => {
  assert.equal((await up(synth(), null)).status, 401);
  assert.equal((await up(synth(), 'mala')).status, 401);
  assert.equal((await up(synth(), KEY + 'x')).status, 401);
  assert.equal((await get().then(r => r.json())).live, false);
});
test('subida con forma incorrecta: 400/422, demasiado grande: 413', async () => {
  assert.equal((await up('{no json')).status, 400);
  assert.equal((await up({ rally: 'x' })).status, 422);
  const bad = synth(); bad.pilotos[0].t.TC99 = [1, 0, 0]; assert.equal((await up(bad)).status, 422);
  const big = synth(); big.rally = 'x'.repeat(300 * 1024); assert.equal((await up(big)).status, 413);
});
test('ida y vuelta: sube, lee, ETag/304, quita campos no previstos, borra', async () => {
  const d = synth({ upTo: 3 }); d.pilotos.forEach((p, i) => { p.ord = i + 1; }); d.pilotos[0].telefono = '600000000'; d.warnings = ['x']; d.pilotos[0].pesos = '33/90';
  const r = await up(d); assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.ok && j.version >= 1);
  await wait(2100);
  const g = await get(); const body = await g.json(); const etag = g.headers.get('etag');
  assert.equal(body.live, true); assert.equal(body.version, j.version); assert.equal(body.data.rally, 'Rally Sintético');
  assert.deepEqual(body.data.pilotos[1].t, d.pilotos[1].t);
  assert.equal(body.data.pilotos[0].ord, 1); assert.equal(body.data.pilotos[1].ord, 2);
  assert.equal(body.data.pilotos[0].telefono, undefined); assert.equal(body.data.pilotos[0].pesos, undefined); assert.equal(body.data.warnings, undefined);
  assert.equal((await get({ 'If-None-Match': etag })).status, 304);
  assert.equal(g.headers.get('access-control-expose-headers'), 'ETag');
  assert.equal((await get({ Origin: 'https://malo.example' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(API + '/data', { method: 'DELETE', headers: { 'X-Upload-Key': 'mala' } })).status, 401);
  assert.equal((await fetch(API + '/data', { method: 'DELETE', headers: { 'X-Upload-Key': KEY } })).status, 200);
  await wait(2100);
  const g2 = await get({ 'If-None-Match': etag }); assert.equal(g2.status, 200); assert.equal((await g2.json()).live, false);
});

test('histórico: solo se archiva un rally final; DELETE /data no lo borra; se puede sobrescribir y borrar el archivo', async () => {
  const mid = synth({ upTo: 3 }); mid.rally = 'Rally Archivo'; mid.date = '2 feb';
  assert.equal((await up(mid)).status, 200);
  await wait(2100);
  let list = await (await fetch(API + '/archive', { headers: { Origin: ORIGIN } })).json();
  assert.ok(Array.isArray(list.rallies));
  assert.ok(!list.rallies.some(r => r.slug === 'rally-archivo-2-feb'));

  const fin = synth(); fin.rally = 'Rally Archivo'; fin.date = '2 feb';
  const u1 = await up(fin); assert.equal(u1.status, 200);
  const body1 = await u1.json();
  assert.ok(body1.at);
  await wait(2100);
  const live = await (await get()).json();
  assert.equal(live.live, true);
  assert.equal(live.updatedAt, live.at);
  assert.equal(live.data.rally, 'Rally Archivo');

  const lr = await fetch(API + '/archive', { headers: { Origin: ORIGIN } });
  assert.equal(lr.headers.get('access-control-allow-origin'), ORIGIN);
  list = await lr.json();
  const hit = list.rallies.find(r => r.slug === 'rally-archivo-2-feb');
  assert.ok(hit, JSON.stringify(list));
  assert.equal(hit.name, 'Rally Archivo');
  assert.equal(hit.date, '2 feb');
  assert.ok(hit.winner && hit.winner.dorsal);

  const item = await (await fetch(API + '/archive/rally-archivo-2-feb', { headers: { Origin: ORIGIN } })).json();
  assert.equal(item.archived, true);
  assert.equal(item.live, false);
  assert.equal(item.data.rally, 'Rally Archivo');
  assert.ok(item.data.pilotos[0].t.TC1);
  assert.equal(item.data.pilotos[0].telefono, undefined);

  // corrección: mismo slug se sobrescribe
  const fin2 = synth(); fin2.rally = 'Rally Archivo'; fin2.date = '2 feb'; fin2.venue = 'Pista Z';
  assert.equal((await up(fin2)).status, 200);
  await wait(2100);
  const item2 = await (await fetch(API + '/archive/rally-archivo-2-feb')).json();
  assert.equal(item2.data.venue, 'Pista Z');
  list = await (await fetch(API + '/archive')).json();
  assert.equal(list.rallies.filter(r => r.slug === 'rally-archivo-2-feb').length, 1);

  // borrar el directo no toca el histórico
  assert.equal((await fetch(API + '/data', { method: 'DELETE', headers: { 'X-Upload-Key': KEY } })).status, 200);
  await wait(2100);
  assert.equal((await get().then(r => r.json())).live, false);
  const still = await (await fetch(API + '/archive/rally-archivo-2-feb')).json();
  assert.equal(still.archived, true);
  assert.equal(still.data.venue, 'Pista Z');

  assert.equal((await fetch(API + '/archive/rally-archivo-2-feb', { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(API + '/archive/rally-archivo-2-feb', { method: 'DELETE', headers: { 'X-Upload-Key': 'mala' } })).status, 401);
  assert.equal((await fetch(API + '/archive/rally-archivo-2-feb', { method: 'DELETE', headers: { 'X-Upload-Key': KEY } })).status, 200);
  assert.equal((await fetch(API + '/archive/rally-archivo-2-feb')).status, 404);
  list = await (await fetch(API + '/archive')).json();
  assert.ok(!list.rallies.some(r => r.slug === 'rally-archivo-2-feb'));
});

test('histórico: temporada, dateKey, podium R1/R2 y orden por temporada y fecha', async () => {
  const a = synth(); a.rally = 'Rally Alfa'; a.date = '10 ene'; a.season = 2026;
  const b = synth(); b.rally = 'Rally Beta'; b.date = '20 dic'; b.season = 2025;
  const c = synth(); c.rally = 'Rally Gamma'; c.date = '5 feb'; c.season = 2026;
  assert.equal((await up(a)).status, 200); await wait(2100);
  assert.equal((await up(b)).status, 200); await wait(2100);
  assert.equal((await up(c)).status, 200); await wait(2100);
  const list = await (await fetch(API + '/archive', { headers: { Origin: ORIGIN } })).json();
  const wanted = ['rally-gamma-5-feb', 'rally-alfa-10-ene', 'rally-beta-20-dic'];
  const got = list.rallies.filter(r => wanted.includes(r.slug)).map(r => r.slug);
  assert.deepEqual(got, wanted);
  const g = list.rallies.find(r => r.slug === 'rally-gamma-5-feb');
  assert.equal(g.season, 2026);
  assert.equal(g.dateKey, '2026-02-05');
  assert.equal(g.podiums.Rally1.length, 3);
  assert.equal(g.podiums.Rally2.length, 2);
  assert.equal(g.podiums.Rally1[0].dorsal, g.winner.dorsal);
  assert.ok(g.podiums.Rally1[0].nombre);
  const beta = list.rallies.find(r => r.slug === 'rally-beta-20-dic');
  assert.equal(beta.season, 2025);
  assert.equal(beta.dateKey, '2025-12-20');
});
