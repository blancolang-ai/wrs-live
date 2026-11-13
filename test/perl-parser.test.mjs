// Compara el lector Perl (Mac 10.13+) con el de JavaScript: misma estructura y mismos avisos.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const P = createRequire(import.meta.url)('../uploader/parser.js');
const PARSER = new URL('../uploader/parser.pl', import.meta.url).pathname;
const WRITE = new URL('./write-xlsx.py', import.meta.url).pathname;

const colL = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
function rowsXml(rows, sIdx, x) {
  return rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    if (v == null) return ''; const ref = colL(ci) + (ri + 1);
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (v && v.err) return `<c r="${ref}" t="e"><f>1/0</f><v>${v.err}</v></c>`;
    if (v && v.f) return `<c r="${ref}" t="str"><f>x</f><v>${x(v.f)}</v></c>`;
    return `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
  }).join('') + '</row>').join('');
}
function filesFor(rows, { sheets = ['Rally Prueba'], bodies } = {}) {
  const ss = [], sIdx = v => { let i = ss.indexOf(v); if (i < 0) { ss.push(v); i = ss.length - 1; } return i; };
  const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const files = {
    'xl/workbook.xml': `<workbook><sheets>${sheets.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((n, i) => `<Relationship Id="rId${i + 1}" Type="w" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
  };
  sheets.forEach((n, i) => {
    const r = (bodies && bodies[n] !== undefined) ? bodies[n] : (i === 0 ? rows : []);
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rowsXml(r, sIdx, x)}</sheetData></worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<sst>${ss.map(s => `<si><t xml:space="preserve">${x(s)}</t></si>`).join('')}</sst>`;
  return files;
}
function book(rows, opts) {
  const files = filesFor(rows, opts);
  return n => files[n] || null;
}
function writeXlsx(rows, opts = {}) {
  const dir = join(tmpdir(), 'rd-perl-test');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  const py = spawnSync('python3', [WRITE, path], { input: JSON.stringify(filesFor(rows, opts)), encoding: 'utf8' });
  if (py.status !== 0) throw new Error(py.stderr || 'write-xlsx failed');
  return path;
}
const getter = f => n => {
  const r = spawnSync('unzip', ['-p', f, n], { encoding: 'utf8', maxBuffer: 64e6 });
  return r.status === 0 && r.stdout ? r.stdout : null;
};
function perlParse(file, sheet) {
  const args = [PARSER];
  if (sheet) args.push('--sheet', sheet);
  args.push(file);
  const r = spawnSync('perl', args, { encoding: 'utf8', maxBuffer: 64e6 });
  if (r.status !== 0) {
    const err = new Error((r.stderr || r.stdout || '').trim());
    err.perl = true;
    throw err;
  }
  return JSON.parse(r.stdout);
}
function compare(rows, opts = {}, parseOpts = {}) {
  const file = writeXlsx(rows, opts);
  const js = P.parse(book(rows, opts), parseOpts);
  const pl = perlParse(file, parseOpts.sheet);
  assert.equal(pl.sheet, js.sheet);
  assert.equal(pl.times, js.times);
  assert.deepEqual(pl.warnings, js.warnings);
  assert.deepEqual(pl.data, js.data);
  return { js, pl };
}

const H = (tcs, withCat = true) => ['Pos.', 'Dorsal', 'Piloto', 'Coche', ...(withCat ? ['Categoría'] : []), 'Pesos', 'Incidencias acumuladas', ...tcs.flatMap(t => [t, 'C.', 'T.']), 'Suma', 'Total Rally Leg 1.1', 'Penalizaciones'];
function sheet({ tcs = [['TC1 Uno 10 km', 'TC2 Dos 5 km'], ['TC3 Tres 8 km (Madera) POWER STAGE']], days = [1, 2], withCat = true, cell = null } = {}) {
  const rows = [['Leyenda:'], ['Pista Sintética', null, 46000, 'Indidencia'], []];
  tcs.forEach((sec, si) => {
    rows.push([`Rally Prueba. Día ${days[si]}`], []);
    rows.push(H(sec, withCat));
    [[1, 'Ana', 'Rally1'], [2, 'Bea', 'Rally1'], [7, 'Ciro', 'Rally2']].forEach(([d, n, c], k) => {
      const r = [k + 1, d, n, 'Coche X', ...(withCat ? [c] : []), '33/90', 0];
      sec.forEach((_, ti) => r.push(cell && cell(si, ti, d) !== undefined ? cell(si, ti, d) : 100 + d + ti, d === 2 && ti === 0 ? 1 : 0, 0));
      r.push(0, 0, d === 7 && si === 0 ? 5 : 0); rows.push(r);
    });
    rows.push([]);
  });
  return rows;
}

test('Perl = JS: hoja completa (tramos, C/T, fecha, PS, avisos vacíos)', () => {
  compare(sheet());
});
test('Perl = JS: numeración irregular y Power Stage sin marcar', () => {
  compare(sheet({ tcs: [['TC1 A', 'TC3 B'], ['TC3 C']] }));
});
test('Perl = JS: DNF y #VALUE!', () => {
  const cell = (si, ti, d) => (si === 1 && d === 1) ? 'DNF' : (si === 0 && ti === 1 && d === 2) ? { err: '#VALUE!' } : undefined;
  compare(sheet({ cell }));
});
test('Perl = JS: a medio rellenar y nombre por fórmula', () => {
  const cell = (si, ti, d) => si === 1 ? null : undefined;
  compare(sheet({ cell }));
  const rows = sheet(); rows[7][2] = { f: 'Ana' };
  compare(rows);
});
test('Perl = JS: formato antiguo sin Categoría', () => {
  compare(sheet({ withCat: false }));
});
test('Perl = JS: pestaña anterior a Plantilla (mayúsculas, espacios, acento)', () => {
  const rows = sheet();
  compare(rows, { sheets: ['Viejo', 'Rally Prueba', 'Plantilla'], bodies: { Viejo: [['nada']], 'Rally Prueba': rows, Plantilla: [['Plantilla']] } });
  compare(rows, { sheets: ['Rally Prueba', '  plÁntilla  '], bodies: { 'Rally Prueba': rows, '  plÁntilla  ': [['x']] } });
  compare(rows, { sheets: ['Rally Prueba', 'PLANTILLA'], bodies: { 'Rally Prueba': rows, PLANTILLA: [['x']] } });
});
test('Perl = JS: una sola pestaña, incluso si se llama Plantilla', () => {
  compare(sheet());
  compare(sheet(), { sheets: ['Plantilla'] });
});
test('Perl = JS: sin Plantilla usa la última y avisa', () => {
  const rows = sheet();
  compare(rows, { sheets: ['Primera', 'Última'], bodies: { Primera: [['nada']], 'Última': rows } });
});
test('Perl = JS: Plantilla primera → el mismo error en español', () => {
  const file = writeXlsx(sheet(), { sheets: ['Plantilla', 'Rally Prueba'] });
  let jsMsg, plMsg;
  try { P.parse(book(sheet(), { sheets: ['Plantilla', 'Rally Prueba'] })); } catch (e) { jsMsg = e.message; }
  try { perlParse(file); } catch (e) { plMsg = e.message; }
  assert.equal(plMsg, jsMsg);
  assert.match(plMsg, /La pestaña «Plantilla» es la primera/);
});
test('Perl = JS: opts.sheet elige una pestaña concreta', () => {
  const rows = sheet();
  compare(rows, { sheets: ['Viejo', 'Rally Prueba', 'Plantilla'], bodies: { Viejo: rows, 'Rally Prueba': [['nada']], Plantilla: [['x']] } }, { sheet: 'Viejo' });
});
test('Perl = JS: sin secciones y archivo inválido', () => {
  let jsMsg, plMsg;
  try { P.parse(book([['hola']])); } catch (e) { jsMsg = e.message; }
  try { perlParse(writeXlsx([['hola']])); } catch (e) { plMsg = e.message; }
  assert.equal(plMsg, jsMsg);
  let jsInv, plInv;
  try { P.parse(() => null); } catch (e) { jsInv = e.message; }
  try { perlParse('/tmp/no-existe-rally.xlsx'); } catch (e) { plInv = e.message; }
  assert.match(jsInv, /xlsx válido/);
  assert.match(plInv, /xlsx válido|unzip/);
});

const REAL = '/home/box/agent-data/agents/049f9fac-433a-4410-902b-3d8a23c2a518/attachments/5055fd415ad221ee6cb3344b221fed7227e8bf3049fcf7bcfae6eb4465ff3f59.xlsx';
for (const sh of ['Montecarlo', 'Suecia', 'Croacia', 'Portugal', 'Kenya', 'Finlandia', 'Plantilla']) {
  test(`Perl = JS en el Excel real, pestaña ${sh}`, () => {
    const js = P.parse(getter(REAL), { sheet: sh });
    const pl = perlParse(REAL, sh);
    assert.equal(pl.sheet, js.sheet);
    assert.equal(pl.times, js.times);
    assert.deepEqual(pl.warnings, js.warnings);
    assert.deepEqual(pl.data, js.data);
  });
}
test('Perl = JS: sin elegir pestaña usa Finlandia (anterior a Plantilla)', () => {
  const js = P.parse(getter(REAL));
  const pl = perlParse(REAL);
  assert.equal(pl.sheet, 'Finlandia');
  assert.equal(pl.sheet, js.sheet);
  assert.equal(pl.times, js.times);
  assert.deepEqual(pl.warnings, js.warnings);
  assert.deepEqual(pl.data, js.data);
});
