#!/bin/bash
# WRS-Live · doble clic para empezar a subir los tiempos del rally.
# Compatible con macOS 10.13 High Sierra y posteriores (bash 3.2, Perl 5.18, AppleScript clásico; sin JXA).
cd "$(dirname "$0")" || exit 1
printf '\033]0;WRS-Live\007'

# UTF-8 en la Terminal y en los diálogos (acentos, «», ✅…)
if locale -a 2>/dev/null | grep -E -q '^es_ES\.(UTF-8|utf8)$'; then
  export LANG=es_ES.UTF-8 LC_ALL=es_ES.UTF-8
else
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
fi

DIR="$(pwd)"
CFG="$DIR/config.json"
PERLbin=/usr/bin/perl
if [ ! -x "$PERLbin" ]; then PERLbin=perl; fi

EXCEL="${RD_EXCEL-}"
SERVER="${RD_SERVER-}"
ONCE=0
NODIALOG="${RD_NODIALOG-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --excel) EXCEL="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --once) ONCE=1; shift ;;
    --nodialog) NODIALOG=1; shift ;;
    --dir) DIR="$2"; cd "$DIR" || exit 1; DIR="$(pwd)"; CFG="$DIR/config.json"; shift 2 ;;
    *)
      if [ -z "$EXCEL" ]; then EXCEL="$1"; fi
      shift
      ;;
  esac
done

# Lee la ruta recordada (config.json junto a estos scripts).
if [ -z "$EXCEL" ] && [ -f "$CFG" ]; then
  EXCEL="$($PERLbin -e '
    use 5.018; use JSON::PP;
    my $f = $ARGV[0];
    open my $fh, "<:utf8", $f or exit 0;
    local $/; my $t = <$fh> // q({});
    my $j = eval { JSON::PP->new->utf8(0)->decode($t) } || {};
    my $p = $j->{excel} // "";
    { use bytes; print $p; }
  ' "$CFG")"
  if [ -n "$EXCEL" ] && [ ! -e "$EXCEL" ]; then
    EXCEL=""
  fi
fi

bad_name() {
  case "$1" in
    */~\$*|~\$*) return 0 ;;
  esac
  local b
  b=$(basename "$1")
  case "$b" in
    .*) return 0 ;;
  esac
  case "$b" in
    *.xlsx|*.XLSX) return 1 ;;
    *) return 0 ;;
  esac
}

choose_excel() {
  local script out
  script="$TMP/choose.applescript"
  $PERLbin -e '
    use 5.018; use utf8; binmode STDOUT, ":utf8";
    print qq{try\n};
    print qq{  POSIX path of (choose file with prompt "Elige el Excel del rally (.xlsx)" of type {"org.openxmlformats.spreadsheetml.sheet", "xlsx"})\n};
    print qq{on error\n  return ""\nend try\n};
  ' > "$script"
  out=$(osascript "$script" 2>/dev/null)
  # quita el retorno final de osascript
  out=${out%"${out##*[![:space:]]}"}
  printf '%s' "$out"
}

confirm_excel() {
  local path="$1" script out name parent
  name=$(basename "$path")
  parent=$(dirname "$path")
  script="$TMP/confirm.applescript"
  $PERLbin -e '
    use 5.018; use utf8; binmode STDOUT, ":utf8";
    sub esc { my $s = shift; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; return $s; }
    my ($name, $parent) = @ARGV;
    print "try\n";
    print "  set r to display dialog \"¿Subo este Excel?\" & return & return & \"" . esc($name) . "\" & return & \"(" . esc($parent) . ")\" buttons {\"Elegir otro\", \"Sí, este\"} default button \"Sí, este\" giving up after 20 with title \"WRS-Live\"\n";
    print "  if gave up of r then\n    return \"Sí, este\"\n  end if\n";
    print "  return button returned of r\n";
    print "on error\n  return \"__CANCEL__\"\nend try\n";
  ' "$name" "$parent" > "$script"
  out=$(osascript "$script" 2>/dev/null)
  out=${out%"${out##*[![:space:]]}"}
  printf '%s' "$out"
}

warn_bad() {
  local script
  script="$TMP/bad.applescript"
  $PERLbin -e '
    use 5.018; use utf8; binmode STDOUT, ":utf8";
    print qq{display dialog "Ese archivo no vale (los «~\$…» son temporales de Excel). Elige el .xlsx del rally." buttons {"Vale"} default button "Vale" with icon caution\n};
  ' > "$script"
  osascript "$script" >/dev/null 2>&1 || true
}

choose_loop() {
  local f
  while :; do
    f=$(choose_excel)
    if [ -z "$f" ]; then
      printf '%s\n' "No se ha elegido ningún Excel. Cierra esta ventana y vuelve a abrir el programa." >&2
      exit 1
    fi
    if bad_name "$f"; then
      warn_bad
      continue
    fi
    printf '%s' "$f"
    return 0
  done
}

if [ -z "$NODIALOG" ] && [ -z "$RD_EXCEL" ] && command -v osascript >/dev/null 2>&1; then
  if TMP=$(mktemp -d /tmp/wrs-live.XXXXXX 2>/dev/null); then
    :
  elif TMP=$(mktemp -d -t wrs-live 2>/dev/null); then
    :
  else
    TMP="/tmp/wrs-live.$$"
    mkdir -p "$TMP"
  fi
  trap 'rm -rf "$TMP"' EXIT

  if [ -n "$EXCEL" ]; then
    BTN=$(confirm_excel "$EXCEL")
    if [ "$BTN" = "__CANCEL__" ] || [ -z "$BTN" ]; then
      printf '%s\n' "Cancelado."
      exit 1
    fi
    if [ "$BTN" = "Elegir otro" ]; then
      EXCEL=$(choose_loop) || exit 1
    fi
  else
    EXCEL=$(choose_loop) || exit 1
  fi
fi

if [ -z "$EXCEL" ]; then
  printf '%s\n' "No se ha elegido ningún Excel. Cierra esta ventana y vuelve a abrir el programa."
  exit 1
fi

# Recuerda la ruta junto a estos scripts (no subas config.json a ningún sitio).
$PERLbin -e '
  use 5.018; use JSON::PP;
  my ($cfg, $excel) = @ARGV;
  my $json = JSON::PP->new->utf8->ascii(0)->encode({ excel => $excel });
  open my $fh, ">:raw", $cfg or die $!;
  print $fh $json;
  close $fh;
' "$CFG" "$EXCEL"

set -- --dir "$DIR" --excel "$EXCEL"
if [ "$ONCE" = "1" ]; then set -- "$@" --once; fi
if [ -n "$SERVER" ]; then set -- "$@" --server "$SERVER"; fi
exec "$PERLbin" "$DIR/subir.pl" "$@"
