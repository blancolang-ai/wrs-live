// La página y version.json deben llevar la misma versión (cache busting).
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ver = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
test('version.json, RD_BUILD y ?v= de los scripts coinciden con package.json', () => {
  const vj = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
  assert.equal(vj.version, ver);
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, new RegExp("window\\.RD_BUILD='" + ver.replace(/\./g, '\\.') + "'"));
  for (const f of ['config.js', 'logic.js', 'app.js']) {
    assert.match(html, new RegExp('src="' + f.replace('.', '\\.') + '\\?v=' + ver.replace(/\./g, '\\.') + '"'));
  }
  assert.match(html, new RegExp('fonts/barlow-400\\.woff2\\?v=' + ver.replace(/\./g, '\\.')));
});
