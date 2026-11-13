/* Rally Directo · lector de la hoja del rally (.xlsx) sin dependencias.
 * En el Mac el programa usa parser.pl (Perl 5.18). Este archivo se mantiene para las pruebas en Node.
 * Entrada: getXml(rutaDentroDelZip) -> string | null. Salida: SOLO los datos públicos del rally + avisos.
 * Si no se indica una hoja, usa la pestaña inmediatamente anterior a «Plantilla»
 * (el Excel puede tener todas las pestañas que sean; un rally nuevo se añade justo antes de «Plantilla»). */
var RallyParser = (function () {
  'use strict';
  function decode(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? decode(m[1]) : null; }
  function texts(xml) { var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g, m; while ((m = re.exec(xml))) out += m[1] ? decode(m[1]) : ''; return out; }
  function colIndex(ref) { var c = /^[A-Z]+/.exec(ref)[0], n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n - 1; }
  var ERR = { v: '#ERR' };

  function foldName(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    if (typeof t.normalize === 'function') t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    else t = t.replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');
    return t;
  }
  function isPlantilla(name) { return foldName(name) === 'plantilla'; }
  function listSheets(wb) {
    return (wb.match(/<sheet\s[^>]*>/g) || []).map(function (x) { return attr(x, 'name') || ''; });
  }
  /* Elige la pestaña del directo: la anterior a «Plantilla». */
  function pickLiveSheet(names) {
    if (!names.length) throw new Error('El libro no tiene hojas');
    if (names.length === 1) return { name: names[0] };
    var i, pi = -1;
    for (i = 0; i < names.length; i++) if (isPlantilla(names[i])) { pi = i; break; }
    if (pi === 0) throw new Error('La pestaña «Plantilla» es la primera del libro; el programa usa la pestaña anterior a «Plantilla». Pon el rally justo antes de «Plantilla».');
    if (pi < 0) return { name: names[names.length - 1], warning: 'El libro no tiene pestaña «Plantilla»; se usa la última («' + names[names.length - 1] + '»)' };
    return { name: names[pi - 1] };
  }

  function readSheet(getXml, wanted) {
    var wb = getXml('xl/workbook.xml'); if (!wb) throw new Error('No es un archivo .xlsx válido (falta workbook.xml)');
    var all = wb.match(/<sheet\s[^>]*>/g) || [], sh = null, pickWarn = null;
    if (!wanted) {
      var pick = pickLiveSheet(listSheets(wb));
      wanted = pick.name; pickWarn = pick.warning || null;
    }
    all.forEach(function (x) { if (!sh && attr(x, 'name') === wanted) sh = [x]; });
    if (!sh) throw new Error(wanted ? 'No existe la hoja «' + wanted + '»' : 'El libro no tiene hojas');
    var sheetName = attr(sh[0], 'name'), rid = attr(sh[0], 'r:id');
    var nSheets = (wb.match(/<sheet\s/g) || []).length;
    var rels = getXml('xl/_rels/workbook.xml.rels') || '', target = null, rm, rre = /<Relationship\s[^>]*>/g;
    while ((rm = rre.exec(rels))) if (attr(rm[0], 'Id') === rid) target = attr(rm[0], 'Target');
    if (!target) target = 'worksheets/sheet1.xml';
    var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    var ssx = getXml('xl/sharedStrings.xml') || '', ss = [], sm, sre = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    while ((sm = sre.exec(ssx))) ss.push(sm[1] ? texts(sm[1]) : '');
    var xml = getXml(path); if (!xml) throw new Error('No se encuentra la hoja ' + path);
    var rows = [], rowRe = /<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, r;
    while ((r = rowRe.exec(xml))) {
      var rn = parseInt(attr(' ' + r[1], 'r'), 10) - 1, cells = [];
      if (r[2]) {
        var cre = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c;
        while ((c = cre.exec(r[2]))) {
          var a = ' ' + c[1], ref = attr(a, 'r'), t = attr(a, 't'), body = c[2] || '';
          if (!ref) continue;
          var vm = /<v>([\s\S]*?)<\/v>/.exec(body), v = null;
          if (t === 's') v = vm ? ss[parseInt(vm[1], 10)] : null;
          else if (t === 'inlineStr') v = texts(body);
          else if (t === 'str') v = vm ? decode(vm[1]) : null;
          else if (t === 'b') v = vm ? vm[1] === '1' : null;
          else if (t === 'e') v = vm ? { err: decode(vm[1]) } : null;
          else v = vm ? parseFloat(vm[1]) : null;
          cells[colIndex(ref)] = v;
        }
      }
      rows[rn] = cells;
    }
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return { name: sheetName, rows: rows, nSheets: nSheets, warning: pickWarn };
  }

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function isStr(v) { return typeof v === 'string'; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  /* Entero o texto con pinta de número («12», « 12», «12.0», «#12») → entero; si no, null. */
  function parseDorsal(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'object' && v.err) return null;
    var n;
    if (isNum(v)) n = v;
    else {
      var s = String(v).replace(/\s+/g, '');
      if (!s) return null;
      s = s.replace(',', '.');
      s = s.replace(/^[^0-9.+-]+/, '');
      if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
      n = parseFloat(s);
    }
    if (!isFinite(n) || n < 0) return null;
    var i = Math.round(n);
    if (Math.abs(n - i) > 1e-6) return null;
    return i;
  }
  function clip(s, max) { if (s == null) return s; s = String(s); return s.length > max ? s.slice(0, max) : s; }
  function asNum(v) {
    if (isNum(v)) return v;
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  /* Recorta y tipa para que el Worker nunca responda 422. */
  function fitWorker(data, warn) {
    if (data.sections.length > 20) { warn.push('Demasiadas secciones (' + data.sections.length + '); se suben las 20 primeras'); data.sections = data.sections.slice(0, 20); }
    if (data.tramos.length > 60) { warn.push('Demasiados tramos (' + data.tramos.length + '); se suben los 60 primeros'); data.tramos = data.tramos.slice(0, 60); }
    data.sections.forEach(function (s, si) {
      s.id = clip(s.id || ('s' + si), 10); s.name = clip(s.name || '', 60);
      var day = asNum(s.day); s.day = day == null ? si : day;
      if (!Array.isArray(s.tramos)) s.tramos = [];
      if (s.tramos.length > 40) s.tramos = s.tramos.slice(0, 40);
    });
    var secN = data.sections.length;
    data.tramos = data.tramos.filter(function (t, ti) {
      t.id = clip(t.id, 10); if (!t.id) return false;
      t.name = clip(t.name || '', 80); t.km = asNum(t.km);
      t.ps = !!t.ps; t.surf = t.surf == null || t.surf === '' ? null : clip(String(t.surf), 30);
      var sec = asNum(t.sec); t.sec = sec == null ? 0 : sec;
      if (t.sec < 0 || t.sec >= secN) { warn.push('Tramo ' + t.id + ': sección fuera de rango; se ignora'); return false; }
      return true;
    });
    var ids = {}; data.tramos.forEach(function (t) { ids[t.id] = 1; });
    var seen = {}, keep = [];
    data.pilotos.forEach(function (p) {
      var d = parseDorsal(p.dorsal);
      if (d == null) return;
      var nombre = p.nombre == null ? '' : String(p.nombre).trim();
      if (!nombre) return;
      if (seen[d]) { warn.push('Dorsal ' + d + ' repetido («' + nombre + '»); se ignora el duplicado'); return; }
      seen[d] = 1;
      var t = {}, src = p.t || {};
      Object.keys(src).forEach(function (k) {
        if (!ids[k] || !src[k]) return;
        var t0 = asNum(src[k][0]), c = asNum(src[k][1]), te = asNum(src[k][2]);
        if (t0 == null) return;
        t[k] = [t0, c == null ? 0 : Math.max(0, Math.round(c)), te == null ? 0 : Math.max(0, Math.round(te))];
      });
      var pen = Array.isArray(p.pen) ? p.pen.map(function (x) { var n = asNum(x); return n == null ? 0 : n; }) : [];
      if (pen.length > 20) pen = pen.slice(0, 20);
      keep.push({ dorsal: d, nombre: clip(nombre, 60), coche: clip(p.coche || '', 80), cat: clip(p.cat || 'Rally1', 20) || 'Rally1', t: t, pen: pen });
    });
    if (keep.length > 200) { warn.push('Demasiados pilotos (' + keep.length + '); se suben los 200 primeros'); keep = keep.slice(0, 200); }
    data.pilotos = keep;
    data.champ = clip(data.champ, 80); data.rally = clip(data.rally, 80); data.venue = data.venue == null ? data.venue : clip(data.venue, 80);
    data.date = clip(data.date || '', 20);
    if (data.cats.length > 6) { warn.push('Demasiadas categorías; se suben las 6 primeras'); data.cats = data.cats.slice(0, 6); }
    data.cats = data.cats.map(function (c) { return clip(c, 20); });
    if (data.dayLabels.length > 10) data.dayLabels = data.dayLabels.slice(0, 10);
    data.dayLabels.forEach(function (d) { d.short = clip(d.short || '', 6); d.long = clip(d.long || '', 40); });
    return data;
  }

  function parseTramo(h) {
    h = norm(h);
    var m = /^TC\s*(\d+)\s*[.\-]?\s*(.*)$/i.exec(h);
    var num = parseInt(m[1], 10), rest = m[2];
    var ps = /power\s*stage/i.test(rest); rest = rest.replace(/power\s*stage/ig, '');
    var surf = null, pm = /\(([^)]*)\)/.exec(rest);
    if (pm) { surf = pm[1].trim() || null; rest = rest.slice(0, pm.index) + rest.slice(pm.index + pm[0].length); }
    var km = null, km_m = /(\d+(?:[.,]\d+)?)\s*k\s*m\.?/i.exec(rest);
    if (km_m) { km = parseFloat(km_m[1].replace(',', '.')); rest = rest.slice(0, km_m.index) + rest.slice(km_m.index + km_m[0].length); }
    var name = rest.replace(/^[\s.\-]+/, '').replace(/[\s.\-]+$/, '').trim();
    return { num: num, name: name, km: km, ps: ps, surf: surf };
  }

  var KNOWN = /^(Pos\.|Dorsal|Piloto|Coche|Categoría|Pesos|Incidencias acumuladas|C\.|T\.|Suma|SUMA .*|Total Rally.*|Dif\. Ant\.|Dif\.1º\.|Penalizaciones)$/i;

  function parse(getXml, opts) {
    opts = opts || {};
    var sheet = readSheet(getXml, opts.sheet), rows = sheet.rows, warn = [];
    if (sheet.warning) warn.push(sheet.warning);
    var venue = null, date = null;
    (rows[1] || []).forEach(function (v) {
      if (isNum(v) && v > 20000 && v < 80000 && !date) { var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); date = { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7 }; }
      else if (isStr(v) && v.trim() && venue === null && v.indexOf('Indid') < 0 && v.indexOf('Leyenda') < 0) venue = v.trim();
    });
    var sections = [], rallyName = null;
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i][0];
      if (!(isStr(a) && /^\s*Rally\b.*D[ií]a\s*\d/.test(a))) continue;
      var title = norm(a), dm = /D[ií]a\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(title);
      rallyName = rallyName || norm(title.split('.')[0]);
      var hi = -1;
      for (var k = i + 1; k < Math.min(i + 12, rows.length); k++) if (rows[k][0] != null && norm(rows[k][0]) === 'Pos.') { hi = k; break; }
      if (hi < 0) { warn.push(title + ': no encuentro la fila de cabecera «Pos.»; se ignora la sección'); continue; }
      var hr = rows[hi], h = [];
      for (var j = 0; j < hr.length; j++) h[j] = hr[j] != null ? norm(hr[j]) : '';
      var col = function (name) { for (var j = 0; j < h.length; j++) if (h[j].toLowerCase() === name.toLowerCase()) return j; return null; };
      var cD = col('Dorsal'), cP = col('Piloto'), cC = col('Coche'), cCat = col('Categoría'), cPen = col('Penalizaciones');
      var cInc = col('Incidencias acumuladas');
      if (cP === null) { warn.push(title + ': sin columna «Piloto»; se ignora la sección'); continue; }
      var tramos = [];
      for (j = 0; j < h.length; j++) {
        var v = h[j];
        if (/^TC\s*\d+/i.test(v)) {
          var pt = parseTramo(hr[j]);
          var cc = h[j + 1] === 'C.' ? j + 1 : null, ct = h[j + 2] === 'T.' ? j + 2 : null;
          if (cc === null || ct === null) warn.push(title + ': TC' + pt.num + ' sin columnas C./T.');
          pt.label = norm(hr[j]); pt.cT = j; pt.cC = cc; pt.cTe = ct; tramos.push(pt);
        } else if (v && !KNOWN.test(v)) warn.push(title + ': columna no reconocida «' + v + '» (se ignora)');
      }
      var drivers = [];
      for (var r2i = hi + 1; r2i < rows.length; r2i++) {
        var r2 = rows[r2i], a2 = r2[0];
        if (isStr(a2) && (/^\s*(Rally|Total)/.test(a2) || norm(a2) === 'Pos.')) break;
        var nm = r2[cP];
        if (!isStr(nm) || !nm.trim()) continue;
        var cellT = function (x, where) {
          if (x == null || x === '') return null;
          if (isNum(x)) return x;
          if (typeof x === 'object' && x.err) { warn.push(where + ': error «' + x.err + '» en la celda; se ignora'); return null; }
          if (isStr(x)) {
            if (/^\s*(DNF|AB\.?|ABANDONO)\s*$/i.test(x)) { warn.push(where + ': texto «' + x.trim() + '»; se trata como abandono (999)'); return 999; }
            var f = parseFloat(x.replace(',', '.'));
            if (/^\s*\d+([.,]\d+)?\s*$/.test(x) && isFinite(f)) { warn.push(where + ': tiempo escrito como texto «' + x.trim() + '»'); return f; }
            warn.push(where + ': texto «' + x.trim() + '» en una celda de tiempo; se ignora'); return null;
          }
          return null;
        };
        var cellN = function (x, where) {
          if (x == null || x === '') return 0;
          if (isNum(x)) return x;
          if (typeof x === 'object' && x.err) { warn.push(where + ': error «' + x.err + '»; se toma 0'); return 0; }
          var f = parseFloat(String(x).replace(',', '.')); return isFinite(f) ? f : 0;
        };
        var cellCT = function (x, where) {
          if (x == null || x === '') return 0;
          if (isNum(x)) { var n = Math.round(x); return n > 0 ? n : 0; }
          if (typeof x === 'object' && x.err) { warn.push(where + ': error «' + x.err + '»; se toma 0'); return 0; }
          var s = String(x).replace(/\s+/g, '');
          if (!s) return 0;
          var t = s.replace(',', '.');
          if (/^\d+(\.\d+)?$/.test(t)) { var f = parseFloat(t); return isFinite(f) && f > 0 ? Math.round(f) : 0; }
          return 1;
        };
        var dorsal = parseDorsal(cD !== null ? r2[cD] : null);
        if (dorsal === null) continue;
        var who = title + ' · ' + nm.trim();
        var excelAcc = null;
        if (cInc !== null) {
          var xv = r2[cInc];
          if (xv != null && xv !== '') {
            if (isNum(xv)) excelAcc = Math.round(xv);
            else if (!(typeof xv === 'object' && xv.err)) {
              var af = parseFloat(String(xv).replace(',', '.'));
              if (isFinite(af)) excelAcc = Math.round(af);
            }
          }
        }
        drivers.push({
          dorsal: dorsal,
          nombre: nm.trim(), coche: cC !== null && r2[cC] != null ? norm(r2[cC]) : '',
          cat: cCat !== null && r2[cCat] != null && norm(r2[cCat]) ? norm(r2[cCat]) : null,
          pen: cPen !== null ? cellN(r2[cPen], who + ' · Penalizaciones') : 0,
          excelAcc: excelAcc,
          t: tramos.map(function (t) {
            var w = who + ' · TC' + t.num;
            return [cellT(r2[t.cT], w), t.cC !== null ? cellCT(r2[t.cC], w + ' C.') : 0, t.cTe !== null ? cellCT(r2[t.cTe], w + ' T.') : 0];
          })
        });
      }
      sections.push({ title: title, day: parseInt(dm[1], 10), part: (dm[2] || '').trim(), tramos: tramos, drivers: drivers, hasCat: cCat !== null });
    }
    if (!sections.length) throw new Error('No encuentro ninguna sección «Rally … Día N» en la hoja «' + sheet.name + '»');
    // ---- normalizar ----
    var nums = []; sections.forEach(function (s) { s.tramos.forEach(function (t) { nums.push(t.num); }); });
    var renum = false;
    for (i = 0; i < nums.length; i++) if (nums[i] !== i + 1) renum = true;
    if (renum) {
      var seen = {}, rep = [];
      nums.forEach(function (n) { if (seen[n]) rep.push(n); seen[n] = 1; });
      warn.push('Numeración de tramos irregular en el Excel [' + nums.join(', ') + ']' + (rep.length ? ' (repetidos: TC' + rep.join(', TC') + ')' : '') + '; la web los numera TC1..TC' + nums.length + ' en orden de columnas');
    }
    var days = []; sections.forEach(function (s) { if (days.indexOf(s.day) < 0) days.push(s.day); }); days.sort(function (x, y) { return x - y; });
    var outSecs = [], outT = [], pil = {}, order = [], kk = 0;
    sections.forEach(function (s, si) {
      var name = 'Día ' + s.day + (s.part ? ' ' + s.part.charAt(0).toUpperCase() + s.part.slice(1).toLowerCase() : '');
      var ids = s.tramos.map(function (t) {
        kk++; var tid = renum ? 'TC' + kk : 'TC' + t.num;
        outT.push({ id: tid, name: t.name || t.label, km: t.km, ps: t.ps, surf: t.surf, sec: si });
        return tid;
      });
      outSecs.push({ id: 's' + si, name: name, day: days.indexOf(s.day), tramos: ids });
      s.drivers.forEach(function (d) {
        var key = d.dorsal !== null ? 'd' + d.dorsal : 'n' + d.nombre.toLowerCase();
        if (!pil[key]) { pil[key] = { dorsal: d.dorsal, nombre: d.nombre, coche: d.coche, cat: d.cat, t: {}, pen: sections.map(function () { return 0; }) }; order.push(key); }
        var p = pil[key];
        if (d.nombre.toLowerCase() !== p.nombre.toLowerCase()) warn.push('Dorsal ' + d.dorsal + ': «' + p.nombre + '» en la 1ª sección pero «' + d.nombre + '» en ' + name);
        if (!p.cat && d.cat) p.cat = d.cat;
        p.pen[si] = round3(d.pen || 0);
        ids.forEach(function (tid, x) { var tv = d.t[x]; if (tv[0] !== null && tv[0] > 0) p.t[tid] = [round3(tv[0]), Math.round(tv[1] || 0), Math.round(tv[2] || 0)]; });
        if (d.excelAcc != null) {
          var calc = 0;
          Object.keys(p.t).forEach(function (tid) {
            var tv = p.t[tid];
            if (!tv || tv[0] === 999) return;
            calc += (tv[1] || 0) + (tv[2] || 0);
          });
          if (calc !== d.excelAcc) warn.push('Dorsal ' + d.dorsal + ': incidencias acumuladas Excel=' + d.excelAcc + ', calculadas=' + calc + ' (' + name + ')');
        }
      });
    });
    var pilotos = order.map(function (k) { return pil[k]; });
    if (outT.length && !outT.some(function (t) { return t.ps; })) warn.push('Ningún tramo marcado como POWER STAGE');
    var cats = []; pilotos.forEach(function (p) { if (p.cat && cats.indexOf(p.cat) < 0) cats.push(p.cat); }); cats.sort();
    if (!cats.length) { warn.push('Sin columna Categoría (formato antiguo): se trata como una sola categoría'); pilotos.forEach(function (p) { p.cat = 'Rally1'; }); cats = ['Rally1']; }
    else {
      var odd = cats.filter(function (c) { return c !== 'Rally1' && c !== 'Rally2'; });
      if (odd.length) warn.push('Categorías no previstas: ' + odd.join(', ') + ' (se muestran con el color de Rally2)');
      var sinCat = pilotos.filter(function (p) { return !p.cat; });
      if (sinCat.length) { warn.push('Sin categoría: ' + sinCat.map(function (p) { return p.nombre; }).join(', ') + ' (se pone Rally1)'); sinCat.forEach(function (p) { p.cat = 'Rally1'; }); if (cats.indexOf('Rally1') < 0) cats.unshift('Rally1'); }
    }
    var times = 0; pilotos.forEach(function (p) { times += Object.keys(p.t).length; });
    if (!times) warn.push('La hoja no tiene tiempos todavía');
    var wd = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'], wdl = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var dayLabels = days.map(function (d, x) {
      if (date) { var w = ((date.wd - (days.length - 1 - x)) % 7 + 7) % 7; return { short: wd[w], long: wdl[w] + ' · Día ' + d }; }
      return { short: 'D' + d, long: 'Día ' + d };
    });
    var data = {
      format: 1, champ: opts.champ || 'WRSlot Cantabria', rally: rallyName, venue: venue,
      date: date ? date.d + ' ' + meses[date.m] : '', sections: outSecs, tramos: outT, pilotos: pilotos, cats: cats, dayLabels: dayLabels
    };
    fitWorker(data, warn);
    times = 0; data.pilotos.forEach(function (p) { times += Object.keys(p.t).length; });
    return { data: data, warnings: warn, sheet: sheet.name, times: times };
  }
  return { parse: parse, readSheet: readSheet, parseTramo: parseTramo, pickLiveSheet: pickLiveSheet, foldName: foldName, parseDorsal: parseDorsal };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RallyParser;
