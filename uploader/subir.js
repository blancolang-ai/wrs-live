/* Rally Directo · programa de subida para macOS (JavaScript for Automation, viene con el Mac: no hay que instalar nada).
 * Lo arranca «Rally Directo.command». Vigila el Excel del rally y, cada vez que se guarda, sube SOLO los datos públicos. */
ObjC.import('Foundation');
var app = Application.currentApplication(); app.includeStandardAdditions = true;
var SERVER = 'https://rally-directo.blancolang.workers.dev';

function sh(cmd) { return app.doShellScript(cmd, { alteringLineEndings: false }); }
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function readText(p) { var s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return (!s || s.isNil()) ? null : ObjC.unwrap(s); }
function writeText(p, s) { $(s).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null); }
function exists(p) { return $.NSFileManager.defaultManager.fileExistsAtPath(p); }
function log(m) { console.log(m); }

function run(argv) {
  var dir = argv[0] || '.';
  if (argv[1]) SERVER = argv[1];
  eval(readText(dir + '/parser.js'));
  eval(readText(dir + '/core.js'));
  var key = (readText(dir + '/clave.txt') || '').trim();
  if (!key) { log('⛔ Falta el archivo clave.txt junto a este programa. Pídeselo a Desarrollos.'); return; }
  var home = ObjC.unwrap($.NSHomeDirectory()), cfgDir = home + '/Library/Application Support/RallyDirecto', cfgFile = cfgDir + '/config.json';
  var tmp = ObjC.unwrap($.NSTemporaryDirectory()) + 'rally-directo-' + ObjC.unwrap($.NSProcessInfo.processInfo.processIdentifier);
  sh('mkdir -p ' + q(cfgDir) + ' ' + q(tmp) + ' && chmod 700 ' + q(tmp));
  var hdr = tmp + '/cabecera.txt'; writeText(hdr, 'X-Upload-Key: ' + key + '\n');
  var cfg = {}; try { cfg = JSON.parse(readText(cfgFile) || '{}'); } catch (e) { cfg = {}; }

  function choose() {
    for (;;) {
      var f;
      try { app.activate(); f = app.chooseFile({ withPrompt: 'Elige el Excel del rally (.xlsx)', ofType: ['org.openxmlformats.spreadsheetml.sheet', 'xlsx'] }).toString(); }
      catch (e) { return null; }
      if (UploaderCore.badName(f)) { app.displayDialog('Ese archivo no vale (los «~$…» son temporales de Excel). Elige el .xlsx del rally.', { buttons: ['Vale'], defaultButton: 'Vale', withIcon: 'caution' }); continue; }
      return f;
    }
  }
  var path = cfg.excel && exists(cfg.excel) ? cfg.excel : null;
  if (path) {
    try {
      var r = app.displayDialog('¿Subo este Excel?\n\n' + path.split('/').pop() + '\n(' + path.replace(/\/[^\/]*$/, '') + ')', { buttons: ['Elegir otro', 'Sí, este'], defaultButton: 'Sí, este', givingUpAfter: 20, withTitle: 'Rally Directo' });
      if (r.buttonReturned === 'Elegir otro') path = choose();
    } catch (e) { log('Cancelado.'); return; }
  } else path = choose();
  if (!path) { log('No se ha elegido ningún Excel. Cierra esta ventana y vuelve a abrir el programa.'); return; }
  cfg.excel = path; writeText(cfgFile, JSON.stringify(cfg));

  var io = {
    now: function () { return Date.now(); },
    log: log,
    hash: function (s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h + ':' + s.length; },
    stat: function (p) { if (!exists(p)) return null; try { var o = sh('/usr/bin/stat -f %m:%z ' + q(p)).trim().split(':'); return { m: +o[0], z: +o[1] }; } catch (e) { return null; } },
    open: function (p) {
      var x = tmp + '/x';
      sh('rm -rf ' + q(x) + ' && mkdir ' + q(x) + ' && /bin/cp ' + q(p) + ' ' + q(tmp + '/copia.xlsx') + ' && /usr/bin/unzip -qq -o ' + q(tmp + '/copia.xlsx') + " 'xl/*' -d " + q(x));
      return function (name) { return readText(x + '/' + name); };
    },
    post: function (json) {
      writeText(tmp + '/datos.json', json);
      var out = sh('/usr/bin/curl -sS -m 20 -o ' + q(tmp + '/resp.txt') + " -w '%{http_code}' -H @" + q(hdr) + " -H 'Content-Type: application/json' --data-binary @" + q(tmp + '/datos.json') + ' ' + q(SERVER + '/upload'));
      return { status: parseInt(out, 10), body: readText(tmp + '/resp.txt') || '' };
    }
  };
  log('');
  log('🏁 Rally Directo · subiendo «' + path.split('/').pop() + '»');
  log('   Página pública: https://blancolang-ai.github.io/rally-directo/');
  log('   Cada vez que guardes el Excel (⌘S) se suben los tiempos. Deja esta ventana abierta durante el rally.');
  log('   Para terminar: cierra esta ventana.');
  log('');
  var st = UploaderCore.newState(path);
  for (;;) { var w = UploaderCore.step(st, io, RallyParser); delay(w); }
}
