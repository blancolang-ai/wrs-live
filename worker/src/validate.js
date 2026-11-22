// Valida la forma de los datos y se queda SOLO con los campos públicos previstos (lista blanca).
const fail = m => { throw new Error(m); };
const str = (v, max, name) => { if (v == null) return null; if (typeof v !== 'string') fail(name + ' no es texto'); return v.slice(0, max); };
const num = (v, name) => { if (v == null) return null; if (typeof v !== 'number' || !Number.isFinite(v)) fail(name + ' no es número'); return v; };
const arr = (v, max, name) => { if (!Array.isArray(v)) fail(name + ' no es lista'); if (v.length > max) fail(name + ': demasiados elementos'); return v; };
const seasonYear = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : null);
  if (typeof n !== 'number' || !Number.isFinite(n)) fail('season no es número');
  const y = Math.round(n);
  if (y < 2000 || y > 2100) fail('season fuera de rango');
  return y;
};
export function sanitize(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('cuerpo no es objeto');
  const sections = arr(b.sections, 20, 'sections').map((s, i) => ({
    id: str(s.id, 10, 'section.id') || 's' + i, name: str(s.name, 60, 'section.name') || '',
    day: num(s.day, 'section.day') ?? fail('section.day'), tramos: arr(s.tramos, 40, 'section.tramos').map(t => str(t, 10, 'section.tramo'))
  }));
  const tramos = arr(b.tramos, 60, 'tramos').map(t => ({
    id: str(t.id, 10, 'tramo.id') || fail('tramo.id'), name: str(t.name, 80, 'tramo.name') || '', km: num(t.km, 'tramo.km'),
    ps: !!t.ps, surf: str(t.surf, 30, 'tramo.surf'), sec: num(t.sec, 'tramo.sec') ?? fail('tramo.sec')
  }));
  if (!tramos.length) fail('sin tramos');
  const ids = new Set(tramos.map(t => t.id));
  if (ids.size !== tramos.length) fail('tramos repetidos');
  tramos.forEach(t => { if (t.sec < 0 || t.sec >= sections.length) fail('tramo.sec fuera de rango'); });
  const pilotos = arr(b.pilotos, 200, 'pilotos').map(p => {
    const t = {};
    if (!p.t || typeof p.t !== 'object') fail('piloto.t');
    for (const [k, v] of Object.entries(p.t)) {
      if (!ids.has(k)) fail('tiempo en tramo desconocido ' + k);
      arr(v, 3, 'tiempo'); t[k] = [num(v[0], 'tiempo') ?? fail('tiempo vacío'), num(v[1], 'C') || 0, num(v[2], 'T') || 0];
    }
    const out = {
      dorsal: num(p.dorsal, 'dorsal') ?? fail('dorsal'), nombre: str(p.nombre, 60, 'nombre') || fail('nombre'), coche: str(p.coche, 80, 'coche') || '',
      cat: str(p.cat, 20, 'cat') || 'Rally1', t, pen: arr(p.pen || [], 20, 'pen').map(x => num(x, 'pen') || 0)
    };
    if (p.ord != null && p.ord !== '') {
      const o = num(p.ord, 'ord');
      const oi = Math.round(o);
      if (oi < 1 || oi > 200) fail('ord fuera de rango');
      out.ord = oi;
    }
    return out;
  });
  if (new Set(pilotos.map(p => p.dorsal)).size !== pilotos.length) fail('dorsales repetidos');
  const season = seasonYear(b.season);
  return {
    format: 1, champ: str(b.champ, 80, 'champ'), rally: str(b.rally, 80, 'rally') || 'Rally', venue: str(b.venue, 80, 'venue'), date: str(b.date, 20, 'date'),
    ...(season != null ? { season } : {}),
    sections, tramos, pilotos, cats: arr(b.cats || ['Rally1'], 6, 'cats').map(c => str(c, 20, 'cat')),
    dayLabels: arr(b.dayLabels || [], 10, 'dayLabels').map(d => ({ short: str(d.short, 6, 'short') || '', long: str(d.long, 40, 'long') || '' }))
  };
}
