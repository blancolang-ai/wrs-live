#!/bin/bash
# WRS-Live · quita el rally de la página pública (vuelve a «Sin rally en directo»).
# Compatible con macOS 10.13 High Sierra y posteriores (bash, curl; sin JXA).
cd "$(dirname "$0")" || exit 1
if locale -a 2>/dev/null | grep -E -q '^es_ES\.(UTF-8|utf8)$'; then
  export LANG=es_ES.UTF-8 LC_ALL=es_ES.UTF-8
else
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
fi
SERVER="https://rally-directo.blancolang.workers.dev"
KEY="$(tr -d '[:space:]' < clave.txt 2>/dev/null)"
if [ -z "$KEY" ]; then echo "Falta clave.txt"; read -r -p "Pulsa Intro para cerrar"; exit 1; fi
read -r -p "¿Quitar el rally de la web? Escribe si y pulsa Intro: " R
if [ "$R" = "si" ] || [ "$R" = "sí" ]; then
  H="$(mktemp)"; chmod 600 "$H"; printf 'header = "X-Upload-Key: %s"\n' "$KEY" > "$H"
  CODE=$(/usr/bin/curl -sS -m 20 -o /dev/null -w '%{http_code}' -X DELETE -K "$H" "$SERVER/data"); rm -f "$H"
  if [ "$CODE" = "200" ]; then echo "✅ Hecho: la web muestra «Sin rally en directo»."; else echo "⛔ No se pudo (código $CODE). ¿Hay internet?"; fi
else echo "No se ha tocado nada."; fi
read -r -p "Pulsa Intro para cerrar"
