#!/bin/bash
# Rally Directo · doble clic para empezar a subir los tiempos del rally.
cd "$(dirname "$0")" || exit 1
printf '\033]0;Rally Directo\007'
exec /usr/bin/osascript -l JavaScript subir.js "$(pwd)"
