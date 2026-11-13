# Escribe un .xlsx mínimo a partir de un JSON {ruta: contenido} por stdin (solo para pruebas).
import json, sys, zipfile
files = json.load(sys.stdin)
out = sys.argv[1]
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for name, content in files.items():
        z.writestr(name, content)
