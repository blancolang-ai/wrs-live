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
  const d = synth({ upTo: 3 }); d.pilotos[0].telefono = '600000000'; d.warnings = ['x']; d.pilotos[0].pesos = '33/90';
  const r = await up(d); assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.ok && j.version >= 1);
  await wait(2100);
  const g = await get(); const body = await g.json(); const etag = g.headers.get('etag');
  assert.equal(body.live, true); assert.equal(body.version, j.version); assert.equal(body.data.rally, 'Rally Sintético');
  assert.deepEqual(body.data.pilotos[1].t, d.pilotos[1].t);
  assert.equal(body.data.pilotos[0].telefono, undefined); assert.equal(body.data.pilotos[0].pesos, undefined); assert.equal(body.data.warnings, undefined);
  assert.equal((await get({ 'If-None-Match': etag })).status, 304);
  assert.equal(g.headers.get('access-control-expose-headers'), 'ETag');
  assert.equal((await get({ Origin: 'https://malo.example' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(API + '/data', { method: 'DELETE', headers: { 'X-Upload-Key': 'mala' } })).status, 401);
  assert.equal((await fetch(API + '/data', { method: 'DELETE', headers: { 'X-Upload-Key': KEY } })).status, 200);
  await wait(2100);
  const g2 = await get({ 'If-None-Match': etag }); assert.equal(g2.status, 200); assert.equal((await g2.json()).live, false);
});
