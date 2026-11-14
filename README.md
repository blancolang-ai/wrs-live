# WRS-Live · WRSlot Cantabria

Página pública con los tiempos de los rallies en directo: <https://blancolang-ai.github.io/wrs-live/>
(antes `…/rally-directo/`, que redirige aquí). Logo: WRSlot Cantabria (`logo-wrslot.webp`, el mismo de la app Eventos).

- `index.html`, `app.js`, `logic.js`: la página (pensada para el móvil). Lee los datos de `GET /data` del Worker cada ~10 s.
- `worker/`: Cloudflare Worker `rally-directo` (`POST /upload` con clave privada, `GET /data` público). Conserva el nombre `rally-directo.blancolang.workers.dev` para no romper el programa del Mac ya instalado.
- `uploader/`: programa del Mac que vigila el Excel y sube solo los datos públicos (bash + Perl, macOS 10.13+; ver `uploader/INSTALAR.md`). Incluye `QR WRS-Live.png` (página pública).
- `test/`: pruebas con datos sintéticos (`npm test`), incluida la comparación del lector Perl con el de JavaScript.

Este repositorio es público: no contiene datos de ningún rally ni la clave de subida (`clave.txt` y `worker/.dev.vars` están en `.gitignore`).

Fuentes: Barlow y Barlow Condensed (SIL Open Font License 1.1).
