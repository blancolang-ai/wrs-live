// Comprobaciones de la interfaz 2.6.0 (textos y estilos en el código; datos sintéticos).
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const app = readFileSync(join(root, 'app.js'), 'utf8');

test('cuando el rally está finalizado, el indicador del directo dice «Rally finalizado»', () => {
  assert.match(app, /textContent = final \? 'Rally finalizado' : 'DIRECTO'/);
  assert.match(app, /final \? 'Rally finalizado' : 'Directo'/);
  assert.match(html, /\.live\.fin\{/);
});

test('en Clasificación, Total va centrado en cabecera y valores', () => {
  assert.match(html, /class="toth">Total</);
  assert.match(html, /#v-clas \.toth,#v-clas \.tot\{text-align:center\}/);
  assert.doesNotMatch(html, /style="text-align:right">Total</);
});

test('la diferencia con el líder es negra y algo mayor (13px, --ink)', () => {
  assert.match(app, /<small class="d1">1º \$\{fdif\(/);
  const m = html.match(/\.dif \.d1\{([^}]*)\}/);
  assert.ok(m, 'falta la regla .dif .d1');
  const rule = m[1];
  assert.match(rule, /color:var\(--ink\)/);
  assert.match(rule, /font:700 13px/);
  assert.match(html, /class="d1h">Dif\. 1º</);
});

test('Orden de salida incluye el primer día (orden del Excel), también si el rally tiene un solo día', () => {
  assert.doesNotMatch(app, /Este rally tiene un solo día: no hay orden de salida/);
  assert.match(app, /orden del Excel/);
  assert.match(app, /S\.day === 0/);
  assert.match(app, /excelOrder/);
  assert.match(app, /Math\.max\(0,/);
});
