// Pruebas del bucle del programa de subida con un Mac simulado (datos SINTÉTICOS).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
const req = createRequire(import.meta.url), C = req('../uploader/core.js');
const parser = { parse: g => g() };
function fakeIo() {
  const io = { t: 0, logs: [], posts: [], file: null, net: 'ok', status: 200,
    now: () => io.t, log: m => io.logs.push(m), hash: s => s,
    stat: () => io.file && { m: io.file.m, z: io.file.z }, open: () => () => { if (io.file.broken) throw new Error('unzip: End-of-central-directory'); return io.file.content; },
    post: j => { if (io.net !== 'ok') throw new Error('curl: (6) Could not resolve host'); io.posts.push(j); return { status: io.status, body: '' }; } };
  io.save = (times, extra = {}) => { const m = (io.file?.m || 0) + 1; io.file = { m, z: 100 + m, content: { data: { rally: 'Rally X', tramos: [{ id: 'TC1' }], pilotos: [{ t: times ? { TC1: [1, 0, 0] } : {} }] }, warnings: extra.warnings || [], times: times ? 1 : 0, sheet: extra.sheet }, broken: extra.broken }; };
  io.run = (secs) => { const st = io.st; const end = io.t + secs * 1000; while (io.t < end) { const w = C.step(st, io, parser); io.t += w * 1000; } };
  io.st = C.newState('/Users/x/Rally.xlsx');
  return io;
}
test('sube al guardar (cuando el archivo deja de cambiar) y no repite si no hay cambios', () => {
  const io = fakeIo(); io.save(false); io.run(5);
  assert.equal(io.posts.length, 1); assert.ok(io.logs.some(l => /✅ Subido \d\d:\d\d:\d\d/.test(l)));
  io.file.m++; io.run(5); assert.equal(io.posts.length, 1); // guardado sin cambios
  io.save(true); io.run(5); assert.equal(io.posts.length, 2);
});
test('sin conexión: reintenta cada 5 s hasta que vuelve', () => {
  const io = fakeIo(); io.net = 'down'; io.save(true); io.run(12);
  assert.equal(io.posts.length, 0); assert.ok(io.logs.filter(l => /sin conexión/.test(l)).length >= 2);
  io.net = 'ok'; io.run(8); assert.equal(io.posts.length, 1);
});
test('clave rechazada: avisa y no insiste; archivo a medio guardar: lo vuelve a intentar', () => {
  const io = fakeIo(); io.status = 401; io.save(true); io.run(10);
  assert.equal(io.posts.length, 1); assert.ok(io.logs.some(l => /rechaza la clave/.test(l)));
  const io2 = fakeIo(); io2.save(true, { broken: true }); io2.run(3); assert.equal(io2.posts.length, 0);
  io2.file.broken = false; io2.file.m++; io2.run(5); assert.equal(io2.posts.length, 1);
});
test('muestra los avisos del lector una sola vez; ignora temporales de Excel', () => {
  const io = fakeIo(); io.save(true, { warnings: ['Ningún tramo marcado como POWER STAGE'] }); io.run(4); io.file.m++; io.run(4);
  assert.equal(io.logs.filter(l => /POWER STAGE/.test(l)).length, 1);
  assert.equal(C.badName('/a/~$Rally.xlsx'), true); assert.equal(C.badName('/a/Rally.xls'), true); assert.equal(C.badName('/a/Rally 2026.xlsx'), false);
});
test('si el Excel desaparece, avisa sin romperse', () => {
  const io = fakeIo(); io.run(4); assert.ok(io.logs.some(l => /No encuentro el Excel/.test(l)));
});

test('anuncia la pestaña usada una vez y otra si cambia', () => {
  const io = fakeIo(); io.save(true, { sheet: 'Finlandia' }); io.run(4);
  assert.equal(io.logs.filter(l => /📄 Usando la pestaña «Finlandia»/.test(l)).length, 1);
  io.file.m++; io.run(4);
  assert.equal(io.logs.filter(l => /📄 Usando la pestaña «Finlandia»/.test(l)).length, 1);
  io.save(true, { sheet: 'Kenya' }); io.run(4);
  assert.equal(io.logs.filter(l => /📄 Usando la pestaña «Kenya»/.test(l)).length, 1);
  assert.equal(io.logs.filter(l => /📄 Usando la pestaña «Finlandia»/.test(l)).length, 1);
});
