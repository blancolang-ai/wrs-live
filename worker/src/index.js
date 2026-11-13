// Rally Directo · Worker: recibe del Mac los datos PÚBLICOS del rally y los sirve a la página.
//   POST   /upload  (cabecera X-Upload-Key)  -> guarda la última versión
//   GET    /data                             -> público, CORS, ETag
//   DELETE /data    (cabecera X-Upload-Key)  -> quita el rally de la web (no borra el histórico)
//   GET    /archive                          -> público, lista de rallies finalizados
//   GET    /archive/<slug>                   -> público, un rally archivado
//   DELETE /archive/<slug> (X-Upload-Key)    -> quita un rally del histórico
import { DurableObject } from 'cloudflare:workers';
import { sanitize } from './validate.js';
import { archiveSlug, isRallyFinal, winnerSummary, isValidSlug, indexEntry, needsHydrate, publicIndex, sortIndex } from './archive.js';

const MAX_BYTES = 256 * 1024;
const te = new TextEncoder();
async function keyOk(given, env) {
  if (!env.UPLOAD_KEY || !given) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', te.encode(given)), crypto.subtle.digest('SHA-256', te.encode(env.UPLOAD_KEY))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
function cors(req, env) {
  const origin = req.headers.get('Origin'), allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin' };
  if (origin && allowed.includes(origin)) Object.assign(h, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Max-Age': '86400' });
  return h;
}
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extra } });

// caché por instancia (2 s) para no despertar el Durable Object en cada petición de los aficionados
let mem = null;

export default {
  async fetch(req, env) {
    const url = new URL(req.url), c = cors(req, env);
    const stub = env.STORE.get(env.STORE.idFromName('directo'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...c, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
    if (url.pathname === '/data' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!mem || Date.now() - mem.t > 2000) mem = { t: Date.now(), body: await stub.read() };
      const etag = '"' + mem.body.etag + '"';
      const h = { ...c, 'ETag': etag, 'Cache-Control': 'public, max-age=3, must-revalidate' };
      if ((req.headers.get('If-None-Match') || '').split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag)) return new Response(null, { status: 304, headers: h });
      return new Response(req.method === 'HEAD' ? null : mem.body.text, { headers: { ...h, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (url.pathname === '/upload' && req.method === 'POST') {
      if (!(await keyOk(req.headers.get('X-Upload-Key'), env))) return json({ ok: false, error: 'clave incorrecta' }, 401);
      const len = +(req.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return json({ ok: false, error: 'demasiado grande' }, 413);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return json({ ok: false, error: 'demasiado grande' }, 413);
      let body; try { body = JSON.parse(new TextDecoder().decode(buf)); } catch { return json({ ok: false, error: 'JSON no válido' }, 400); }
      let data; try { data = sanitize(body); } catch (e) { return json({ ok: false, error: 'formato: ' + e.message }, 422); }
      const r = await stub.write(data); mem = null;
      return json({ ok: true, version: r.version, at: r.at });
    }
    if (url.pathname === '/data' && req.method === 'DELETE') {
      if (!(await keyOk(req.headers.get('X-Upload-Key'), env))) return json({ ok: false, error: 'clave incorrecta' }, 401);
      await stub.clear(); mem = null;
      return json({ ok: true });
    }
    if (url.pathname === '/archive' && (req.method === 'GET' || req.method === 'HEAD')) {
      const list = await stub.listArchive();
      const text = JSON.stringify({ rallies: list });
      const h = { ...c, 'Cache-Control': 'public, max-age=3, must-revalidate', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
      return new Response(req.method === 'HEAD' ? null : text, { headers: h });
    }
    const arch = url.pathname.match(/^\/archive\/([^/]+)$/);
    if (arch && (req.method === 'GET' || req.method === 'HEAD')) {
      const slug = decodeURIComponent(arch[1]);
      if (!isValidSlug(slug)) return json({ ok: false, error: 'no encontrado' }, 404, c);
      const item = await stub.readArchive(slug);
      if (!item) return json({ ok: false, error: 'no encontrado' }, 404, c);
      const text = JSON.stringify(item);
      const h = { ...c, 'Cache-Control': 'public, max-age=3, must-revalidate', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
      return new Response(req.method === 'HEAD' ? null : text, { headers: h });
    }
    if (arch && req.method === 'DELETE') {
      if (!(await keyOk(req.headers.get('X-Upload-Key'), env))) return json({ ok: false, error: 'clave incorrecta' }, 401);
      const slug = decodeURIComponent(arch[1]);
      if (!isValidSlug(slug)) return json({ ok: false, error: 'no encontrado' }, 404);
      const ok = await stub.deleteArchive(slug);
      return json(ok ? { ok: true } : { ok: false, error: 'no encontrado' }, ok ? 200 : 404);
    }
    if (url.pathname === '/') return json({ ok: true, service: 'rally-directo' }, 200, c);
    return json({ ok: false, error: 'no encontrado' }, 404, c);
  }
};

export class Store extends DurableObject {
  async read() {
    const s = await this.ctx.storage.get('state');
    if (!s) { const v = (await this.ctx.storage.get('version')) || 0; return { etag: 'v' + v + '-0', text: JSON.stringify({ live: false, version: v }) }; }
    return { etag: 'v' + s.version, text: s.text };
  }
  async write(data) {
    const version = ((await this.ctx.storage.get('version')) || 0) + 1, at = new Date().toISOString();
    const text = JSON.stringify({ live: true, version, at, updatedAt: at, data });
    await this.ctx.storage.put({ state: { version, text }, version });
    if (isRallyFinal(data)) await this._archivePut(data, at);
    return { version, at };
  }
  async clear() {
    const version = ((await this.ctx.storage.get('version')) || 0) + 1;
    await this.ctx.storage.delete('state'); await this.ctx.storage.put('version', version);
  }
  async _archivePut(data, at) {
    const slug = archiveSlug(data);
    if (!isValidSlug(slug)) return;
    const winner = winnerSummary(data);
    const item = { live: false, archived: true, slug, at, updatedAt: at, data };
    const idx = (await this.ctx.storage.get('archiveIndex')) || [];
    const entry = indexEntry(slug, data, winner, at);
    const next = [entry, ...idx.filter(e => e.slug !== slug)];
    await this.ctx.storage.put({ ['archive:' + slug]: item, archiveIndex: next });
  }
  async listArchive() {
    const idx = (await this.ctx.storage.get('archiveIndex')) || [];
    let dirty = false;
    const next = [];
    for (const e of idx) {
      if (needsHydrate(e)) {
        const item = await this.ctx.storage.get('archive:' + e.slug);
        if (item && item.data) {
          next.push(indexEntry(e.slug, item.data, e.winner || winnerSummary(item.data), e.at || item.at));
          dirty = true;
          continue;
        }
      }
      next.push(e);
    }
    if (dirty) await this.ctx.storage.put('archiveIndex', next);
    return sortIndex(next).map(publicIndex);
  }
  async readArchive(slug) { return (await this.ctx.storage.get('archive:' + slug)) || null; }
  async deleteArchive(slug) {
    const item = await this.ctx.storage.get('archive:' + slug);
    if (!item) return false;
    const idx = ((await this.ctx.storage.get('archiveIndex')) || []).filter(e => e.slug !== slug);
    await this.ctx.storage.delete('archive:' + slug);
    await this.ctx.storage.put('archiveIndex', idx);
    return true;
  }
}
