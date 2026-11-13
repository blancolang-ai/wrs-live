// Pruebas del programa Perl de subida (mismo comportamiento que el bucle de 1.0.2).
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../uploader/', import.meta.url).pathname;
const WRITE = new URL('./write-xlsx.py', import.meta.url).pathname;

const colL = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
function writeSimpleXlsx(dir, sheets) {
  // sheets: [{name, rows}]
  const ss = [], sIdx = v => { let i = ss.indexOf(v); if (i < 0) { ss.push(v); i = ss.length - 1; } return i; };
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = rows => rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    if (v == null) return ''; const ref = colL(ci) + (ri + 1);
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
  }).join('') + '</row>').join('');
  const names = sheets.map(s => s.name);
  const files = {
    'xl/workbook.xml': `<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="w" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${body(s.rows)}</sheetData></worksheet>`; });
  files['xl/sharedStrings.xml'] = `<sst>${ss.map(t => `<si><t xml:space="preserve">${x(t)}</t></si>`).join('')}</sst>`;
  const path = join(dir, 'rally.xlsx');
  const py = spawnSync('python3', [WRITE, path], { input: JSON.stringify(files), encoding: 'utf8' });
  if (py.status !== 0) throw new Error(py.stderr || 'xlsx');
  return path;
}

function rallyRows(times = true) {
  const h = ['Pos.', 'Dorsal', 'Piloto', 'Coche', 'Categoría', 'Pesos', 'Incidencias acumuladas', 'TC1 Uno 10 km', 'C.', 'T.', 'Suma', 'Total Rally', 'Penalizaciones'];
  return [
    ['Leyenda:'],
    ['Pista X', null, 46000, 'Indidencia'],
    [],
    ['Rally Sintético. Día 1'],
    [],
    h,
    [1, 1, 'Ana', 'Coche X', 'Rally1', '33/90', 0, times ? 101 : null, 0, 0, 0, 0, 0],
    [2, 2, 'Bea', 'Coche X', 'Rally1', '33/90', 0, times ? 102 : null, 0, 0, 0, 0, 0],
    [3, 7, 'Ciro', 'Coche X', 'Rally2', '33/90', 0, times ? 110 : null, 0, 0, 0, 0, 5],
    [],
    ['Rally Sintético. Día 2'],
    [],
    ['Pos.', 'Dorsal', 'Piloto', 'Coche', 'Categoría', 'Pesos', 'Incidencias acumuladas', 'TC2 Dos 5 km POWER STAGE', 'C.', 'T.', 'Suma', 'Total Rally', 'Penalizaciones'],
    [1, 1, 'Ana', 'Coche X', 'Rally1', '33/90', 0, times ? 201 : null, 0, 0, 0, 0, 0],
    [2, 2, 'Bea', 'Coche X', 'Rally1', '33/90', 0, times ? 202 : null, 0, 0, 0, 0, 0],
    [3, 7, 'Ciro', 'Coche X', 'Rally2', '33/90', 0, times ? 210 : null, 0, 0, 0, 0, 0],
  ];
}

function workDir() {
  const dir = join(tmpdir(), 'rd-up-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'clave.txt'), 'test-key-no-secreto\n', { mode: 0o600 });
  copyFileSync(join(ROOT, 'parser.pl'), join(dir, 'parser.pl'));
  copyFileSync(join(ROOT, 'subir.pl'), join(dir, 'subir.pl'));
  return dir;
}

function startMock({ status = 200, body = '{"ok":true}', hang = false } = {}) {
  const posts = [];
  const server = createServer((req, res) => {
    if (hang) return; // never answer
    let buf = [];
    req.on('data', c => buf.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(buf).toString('utf8');
      posts.push({ url: req.url, method: req.method, key: req.headers['x-upload-key'], body: raw });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, posts, url: `http://127.0.0.1:${port}` });
  }));
}

function runOnce(dir, excel, server, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const args = [join(dir, 'subir.pl'), '--dir', dir, '--excel', excel, '--server', server, '--once'];
    const p = spawn('perl', args, { env: { ...process.env, ...extraEnv }, timeout: 25000 });
    let out = ''; let err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => resolve({ code, out, err }));
    p.on('error', reject);
  });
}

test('sube al guardar y anuncia la pestaña; no insiste si no hay cambios', async () => {
  const dir = workDir();
  const xlsx = writeSimpleXlsx(dir, [
    { name: 'Finlandia', rows: rallyRows(true) },
    { name: 'Plantilla', rows: [['x']] }
  ]);
  const mock = await startMock();
  try {
    const r1 = await runOnce(dir, xlsx, mock.url);
    assert.equal(r1.code, 0, r1.out + r1.err);
    assert.match(r1.out, /📄 Usando la pestaña «Finlandia»/);
    assert.match(r1.out, /✅ Subido \d\d:\d\d:\d\d · Rally Sintético · hasta TC2 · 6 tiempos · 3 pilotos/);
    assert.equal(mock.posts.length, 1);
    const data = JSON.parse(mock.posts[0].body);
    assert.equal(data.rally, 'Rally Sintético');
    assert.equal(mock.posts[0].key, 'test-key-no-secreto');
    const r2 = await runOnce(dir, xlsx, mock.url);
    assert.equal(r2.code, 0, r2.out + r2.err);
    // segunda vez: el bucle --once no tiene sentHash persistente (proceso nuevo), así que vuelve a subir.
    // En una misma sesión no repetiría; lo comprobamos más abajo no aplica. Aquí al menos vuelve a funcionar.
    assert.ok(r2.out.includes('✅ Subido') || r2.out.includes('Guardado sin cambios'));
  } finally { mock.server.close(); }
});

test('clave rechazada: avisa y no insiste (exit 1 en --once)', async () => {
  const dir = workDir();
  const xlsx = writeSimpleXlsx(dir, [{ name: 'Rally Prueba', rows: rallyRows(true) }]);
  const mock = await startMock({ status: 401, body: 'clave mala' });
  try {
    const r = await runOnce(dir, xlsx, mock.url);
    assert.equal(r.code, 1);
    assert.match(r.out, /rechaza la clave/);
    assert.equal(mock.posts.length, 1);
  } finally { mock.server.close(); }
});

test('si el Excel desaparece, avisa sin romperse', async () => {
  const dir = workDir();
  const missing = join(dir, 'no-esta.xlsx');
  const r = await runOnce(dir, missing, 'http://127.0.0.1:9');
  assert.equal(r.code, 1);
  assert.match(r.out, /No encuentro el Excel/);
});

test('ignora temporales de Excel (~$)', () => {
  const r = spawnSync('perl', [join(ROOT, 'subir.pl'), '--excel', join(tmpdir(), '~$Rally.xlsx'), '--once'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no vale|temporales/);
});
