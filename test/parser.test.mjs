// Pruebas del lector con hojas .xlsx SINTÉTICAS (XML generado aquí, sin datos reales).
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../uploader/parser.js');
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
function book(rows, { sheets = ['Rally Prueba'], bodies } = {}) {
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
  return n => files[n] || null;
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
test('lee secciones, tramos, km, superficie, power stage, C/T, penalizaciones y fecha', () => {
  const { data, warnings } = P.parse(book(sheet()));
  assert.equal(data.rally, 'Rally Prueba'); assert.equal(data.venue, 'Pista Sintética'); assert.equal(data.date, '9 dic');
  assert.deepEqual(data.tramos.map(t => [t.id, t.name, t.km, t.ps, t.surf, t.sec]), [['TC1', 'Uno', 10, false, null, 0], ['TC2', 'Dos', 5, false, null, 0], ['TC3', 'Tres', 8, true, 'Madera', 1]]);
  assert.deepEqual(data.cats, ['Rally1', 'Rally2']);
  const ana = data.pilotos.find(p => p.nombre === 'Ana'), bea = data.pilotos.find(p => p.nombre === 'Bea'), ciro = data.pilotos.find(p => p.dorsal === 7);
  assert.deepEqual(ana.t.TC1, [101, 0, 0]); assert.deepEqual(bea.t.TC1, [102, 1, 0]); assert.deepEqual(ciro.pen, [5, 0]);
  assert.deepEqual(warnings, []);
  // solo campos públicos: nada de «Pesos»
  assert.ok(!JSON.stringify(data).includes('33/90'));
});
test('avisa (sin romper) de TC repetidos/saltados y Power Stage sin marcar', () => {
  const { data, warnings } = P.parse(book(sheet({ tcs: [['TC1 A', 'TC3 B'], ['TC3 C']] })));
  assert.deepEqual(data.tramos.map(t => t.id), ['TC1', 'TC2', 'TC3']);
  assert.ok(warnings.some(w => /irregular/.test(w) && /repetidos: TC3/.test(w)));
  assert.ok(warnings.some(w => /POWER STAGE/.test(w)));
});
test('avisa de «DNF» (abandono) y de #VALUE! (se ignora)', () => {
  const cell = (si, ti, d) => (si === 1 && d === 1) ? 'DNF' : (si === 0 && ti === 1 && d === 2) ? { err: '#VALUE!' } : undefined;
  const { data, warnings } = P.parse(book(sheet({ cell })));
  assert.deepEqual(data.pilotos[0].t.TC3, [999, 0, 0]);
  assert.equal(data.pilotos[1].t.TC2, undefined);
  assert.ok(warnings.some(w => /DNF/.test(w))); assert.ok(warnings.some(w => /#VALUE!/.test(w)));
});
test('hoja a medio rellenar: celdas vacías = pendientes; resultados de fórmula de texto', () => {
  const cell = (si, ti, d) => si === 1 ? null : undefined;
  const { data, warnings } = P.parse(book(sheet({ cell })));
  assert.equal(data.pilotos[0].t.TC3, undefined); assert.ok(data.pilotos[0].t.TC1);
  assert.deepEqual(warnings, []);
  const rows = sheet(); rows[7][2] = { f: 'Ana' }; // nombre calculado por fórmula
  assert.equal(P.parse(book(rows)).data.pilotos[0].nombre, 'Ana');
});
test('formato antiguo sin Categoría: una sola categoría con aviso', () => {
  const { data, warnings } = P.parse(book(sheet({ withCat: false })));
  assert.deepEqual(data.cats, ['Rally1']); assert.ok(warnings.some(w => /formato antiguo/.test(w)));
});
test('libro sin secciones: error claro; archivo inválido: error claro', () => {
  assert.throws(() => P.parse(book([['hola']])), /ninguna sección/);
  assert.throws(() => P.parse(() => null), /xlsx válido/);
});
test('varias pestañas: usa la anterior a «Plantilla» (también con mayúsculas, espacios o acento)', () => {
  const rows = sheet();
  const r = P.parse(book(rows, {
    sheets: ['Viejo', 'Rally Prueba', 'Plantilla'],
    bodies: { Viejo: [['nada']], 'Rally Prueba': rows, Plantilla: [['Plantilla']] }
  }));
  assert.equal(r.sheet, 'Rally Prueba');
  assert.equal(r.data.rally, 'Rally Prueba');
  assert.ok(!r.warnings.some(w => /primera|Plantilla/.test(w)));

  const r2 = P.parse(book(rows, {
    sheets: ['Rally Prueba', '  plÁntilla  '],
    bodies: { 'Rally Prueba': rows, '  plÁntilla  ': [['x']] }
  }));
  assert.equal(r2.sheet, 'Rally Prueba');

  const r3 = P.parse(book(rows, {
    sheets: ['Rally Prueba', 'PLANTILLA'],
    bodies: { 'Rally Prueba': rows, PLANTILLA: [['x']] }
  }));
  assert.equal(r3.sheet, 'Rally Prueba');
});
test('una sola pestaña: se usa esa, aunque se llame «Plantilla»', () => {
  const r = P.parse(book(sheet()));
  assert.equal(r.sheet, 'Rally Prueba');
  assert.ok(!r.warnings.some(w => /Plantilla/.test(w)));
  const r2 = P.parse(book(sheet(), { sheets: ['Plantilla'] }));
  assert.equal(r2.sheet, 'Plantilla');
  assert.equal(r2.data.rally, 'Rally Prueba');
});
test('sin pestaña «Plantilla»: usa la última y avisa', () => {
  const rows = sheet();
  const r = P.parse(book(rows, {
    sheets: ['Primera', 'Última'],
    bodies: { Primera: [['nada']], 'Última': rows }
  }));
  assert.equal(r.sheet, 'Última');
  assert.ok(r.warnings.some(w => /no tiene pestaña «Plantilla»/.test(w) && /Última/.test(w)));
});
test('«Plantilla» es la primera (con más pestañas): error claro en español', () => {
  assert.throws(
    () => P.parse(book(sheet(), { sheets: ['Plantilla', 'Rally Prueba'] })),
    /La pestaña «Plantilla» es la primera/
  );
});
test('opts.sheet sigue eligiendo una pestaña concreta', () => {
  const rows = sheet();
  const r = P.parse(book(rows, {
    sheets: ['Viejo', 'Rally Prueba', 'Plantilla'],
    bodies: { Viejo: rows, 'Rally Prueba': [['nada']], Plantilla: [['x']] }
  }), { sheet: 'Viejo' });
  assert.equal(r.sheet, 'Viejo');
  assert.equal(r.data.rally, 'Rally Prueba');
});
