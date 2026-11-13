# Rally Directo · WRSlot Cantabria

Página pública con los tiempos de los rallies en directo: <https://blancolang-ai.github.io/rally-directo/>

- `index.html`, `app.js`, `logic.js`: la página (pensada para el móvil). Lee los datos de `GET /data` del Worker cada ~10 s.
- `worker/`: Cloudflare Worker `rally-directo` (`POST /upload` con clave privada, `GET /data` público).
- `uploader/`: programa del Mac que vigila el Excel y sube solo los datos públicos (bash + Perl, macOS 10.13+; ver `uploader/INSTALAR.md`). Incluye `QR Rally Directo.png` (página pública).
- `test/`: pruebas con datos sintéticos (`npm test`), incluida la comparación del lector Perl con el de JavaScript.

Este repositorio es público: no contiene datos de ningún rally ni la clave de subida (`clave.txt` y `worker/.dev.vars` están en `.gitignore`).

Fuentes: Barlow y Barlow Condensed (SIL Open Font License 1.1).
