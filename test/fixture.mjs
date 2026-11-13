// Datos SINTÉTICOS para las pruebas (pilotos inventados).
export function synth({ upTo = 99, abandon = null } = {}) {
  const tramos = [], sections = [];
  const plan = [[0, 'Día 1 Mañana', 2], [0, 'Día 1 Tarde', 2], [1, 'Día 2', 2], [2, 'Día 3', 2]];
  let k = 0;
  plan.forEach(([day, name, n], si) => { const ids = []; for (let i = 0; i < n; i++) { k++; ids.push('TC' + k); tramos.push({ id: 'TC' + k, name: 'Tramo ' + k, km: 10 + k, ps: k === 8, surf: null, sec: si }); } sections.push({ id: 's' + si, name, day, tramos: ids }); });
  const pil = [[1, 'Alfa', 'Rally1'], [2, 'Bravo', 'Rally1'], [3, 'Charlie', 'Rally1'], [11, 'Delta', 'Rally2'], [12, 'Eco', 'Rally2']];
  const base = { 1: 100, 2: 101, 3: 103, 11: 110, 12: 109 };
  const pilotos = pil.map(([dorsal, nombre, cat]) => {
    const t = {};
    tramos.forEach((tr, ti) => {
      if (ti >= upTo) return;
      if (abandon && abandon.d === dorsal && ti >= abandon.ti) { if (ti === abandon.ti) t[tr.id] = [999, 0, 0]; return; }
      const v = base[dorsal] + ((ti * 7 + dorsal * 3) % 5) * 0.5;
      t[tr.id] = [v, dorsal === 2 && ti === 1 ? 1 : 0, 0];
    });
    return { dorsal, nombre, coche: 'Coche ' + dorsal, cat, t, pen: sections.map((s, si) => dorsal === 3 && si === 0 ? 10 : 0) };
  });
  return { format: 1, champ: 'Prueba', rally: 'Rally Sintético', venue: 'Pista X', date: '1 ene', sections, tramos, pilotos, cats: ['Rally1', 'Rally2'], dayLabels: [{ short: 'VIE', long: 'Viernes · Día 1' }, { short: 'SÁB', long: 'Sábado · Día 2' }, { short: 'DOM', long: 'Domingo · Día 3' }] };
}
