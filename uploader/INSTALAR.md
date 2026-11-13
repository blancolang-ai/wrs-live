# Rally Directo · programa para el Mac

Este programa vigila el Excel del rally y, **cada vez que lo guardas**, sube los tiempos a la página pública
<https://blancolang-ai.github.io/rally-directo/>. Solo sube lo que se ve en la web: nombres, dorsales, coches,
categorías, tramos, tiempos, C/T, abandonos (999) y penalizaciones. Nada más del Excel sale del Mac.

**No hay que instalar nada**: usa herramientas que ya vienen con macOS (JavaScript de Automatización, `unzip` y `curl`).

## Instalarlo (una sola vez)

1. Copia la carpeta **RallyDirecto** donde quieras (por ejemplo, en Documentos). Dentro tiene que estar el archivo `clave.txt`
   (es la llave privada para subir; no la compartas).
2. La primera vez, haz **clic derecho (o Control + clic) sobre «Rally Directo.command» → Abrir → Abrir**.
   macOS lo pide solo la primera vez porque el programa no viene de la App Store.
   - Si macOS dice que «no se puede abrir»: ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de
     «Rally Directo.command» y pulsa **Abrir igualmente**.
3. Elige el Excel del rally (el que tiene una sola pestaña). El programa lo recuerda para las siguientes veces.

## Usarlo en cada rally

1. Abre el Excel del rally.
2. Haz **doble clic en «Rally Directo.command»**. Se abre una ventana de Terminal; confirma que es el Excel correcto
   (o pulsa «Elegir otro»).
3. Apunta los tiempos y **guarda con ⌘S** a menudo. Al guardar verás en la ventana algo como:
   `✅ Subido 16:02:31 · Rally Ejemplo · hasta TC5 · 54 tiempos · 12 pilotos`.
   En unos 15–30 segundos aparece en la web.
4. Al terminar el rally, cierra la ventana de Terminal. La web se queda con la clasificación final.
   Si quieres que la web vuelva a «Sin rally en directo», haz doble clic en **«Quitar rally de la web.command»**.

## Bueno saber

- **El Mac necesita internet** durante el rally (vale compartir datos desde el móvil). Si se corta, la ventana dice
  «sin conexión… reintento en 5 s» y sube solo cuando vuelve.
- **Solo se sube lo guardado.** El autoguardado de Excel no funciona con archivos locales: guarda con ⌘S.
- No cierres la ventana de Terminal durante el rally.
- Los archivos `~$…` que crea Excel se ignoran.
- Si la ventana muestra avisos «⚠» (por ejemplo, un TC repetido o el Power Stage sin marcar), revisa la hoja y vuelve a guardar.
- Si el servidor rechaza la clave («⛔ … rechaza la clave»), pide un `clave.txt` nuevo a Desarrollos.
