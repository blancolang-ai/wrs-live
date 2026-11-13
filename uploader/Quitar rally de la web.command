#!/bin/bash
# Rally Directo · quita el rally de la página pública (vuelve a «Sin rally en directo»).
cd "$(dirname "$0")" || exit 1
SERVER="https://rally-directo.blancolang.workers.dev"
KEY="$(tr -d '[:space:]' < clave.txt 2>/dev/null)"
if [ -z "$KEY" ]; then echo "Falta clave.txt"; read -r -p "Pulsa Intro para cerrar"; exit 1; fi
read -r -p "¿Quitar el rally de la web? Escribe si y pulsa Intro: " R
if [ "$R" = "si" ] || [ "$R" = "sí" ]; then
  H="$(mktemp)"; printf 'X-Upload-Key: %s\n' "$KEY" > "$H"
  CODE=$(/usr/bin/curl -sS -m 20 -o /dev/null -w '%{http_code}' -X DELETE -H @"$H" "$SERVER/data"); rm -f "$H"
  if [ "$CODE" = "200" ]; then echo "✅ Hecho: la web muestra «Sin rally en directo»."; else echo "⛔ No se pudo (código $CODE). ¿Hay internet?"; fi
else echo "No se ha tocado nada."; fi
read -r -p "Pulsa Intro para cerrar"
