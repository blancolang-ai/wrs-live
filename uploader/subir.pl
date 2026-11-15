# WRS-Live · bucle de subida para macOS 10.13+ (Perl 5.18, módulos CORE, curl, unzip).
# Lo arranca «WRS-Live.command». Vigila el Excel y, cada vez que se guarda, sube SOLO los datos públicos.
use 5.018;
use strict;
use warnings;
use utf8;
use FindBin;
use lib $FindBin::Bin;
use File::Basename qw(basename dirname);
use File::Copy qw(copy);
use File::Path qw(make_path remove_tree);
use File::Temp qw(tempdir);
use File::Spec;
use POSIX qw(strftime);
use Digest::SHA qw(sha1_hex);
use Encode;
require "$FindBin::Bin/parser.pl";

my $HAS_HIRES = eval { require Time::HiRes; 1 };

sub now_ms {
  return $HAS_HIRES ? int(Time::HiRes::time() * 1000) : time() * 1000;
}
sub delay_s {
  my ($s) = @_;
  if ($HAS_HIRES) { Time::HiRes::sleep($s); }
  else { my $n = $s < 1 ? 1 : int($s + 0.5); sleep($n); }
}
sub hhmmss {
  my ($ms) = @_;
  return strftime('%H:%M:%S', localtime(int(($ms // now_ms()) / 1000)));
}
sub logmsg {
  my ($m) = @_;
  print $m, "\n";
}

binmode STDOUT, ':encoding(UTF-8)';
binmode STDERR, ':encoding(UTF-8)';
$| = 1;

my $dir = $FindBin::Bin;
my $excel;
my $once = 0;
my $server = 'https://rally-directo.blancolang.workers.dev';
if ($ENV{RD_DIR}) { $dir = $ENV{RD_DIR}; }
if ($ENV{RD_EXCEL}) { $excel = $ENV{RD_EXCEL}; }
if ($ENV{RD_SERVER}) { $server = $ENV{RD_SERVER}; }
if ($ENV{RD_ONCE}) { $once = 1; }
while (@ARGV) {
  my $a = shift @ARGV;
  if ($a eq '--dir') { $dir = shift @ARGV; }
  elsif ($a eq '--excel') { $excel = shift @ARGV; }
  elsif ($a eq '--server') { $server = shift @ARGV; }
  elsif ($a eq '--once') { $once = 1; }
  elsif ($a !~ /^-/) { $excel = $a unless defined $excel; }
}

sub bad_name {
  my ($p) = @_;
  my $b = basename($p);
  return 1 if $b =~ /^~\$/ || $b =~ /^\./ || $b !~ /\.xlsx$/i;
  return 0;
}

if (!defined $excel || $excel eq '') {
  logmsg('No se ha elegido ningún Excel. Cierra esta ventana y vuelve a abrir el programa.');
  exit 1;
}
if (bad_name($excel)) {
  logmsg('⚠ Ese archivo no vale (los «~$…» son temporales de Excel). Elige el .xlsx del rally.');
  exit 1;
}

my $keyfile = File::Spec->catfile($dir, 'clave.txt');
my $key = '';
if (open my $kf, '<:raw', $keyfile) {
  local $/;
  $key = <$kf> // '';
  close $kf;
  $key =~ s/^\xEF\xBB\xBF//;
  $key =~ s/^\s+|\s+$//g;
}
if ($key eq '') {
  logmsg('⛔ Falta el archivo clave.txt junto a este programa. Pídeselo a Desarrollos.');
  exit 1;
}

my $tmp = tempdir('wrs-live-XXXXXX', TMPDIR => 1, CLEANUP => 1);
chmod 0700, $tmp;
my $hdr = File::Spec->catfile($tmp, 'cabecera.txt');
{
  open my $hf, '>:raw', $hdr or die "No puedo escribir la cabecera\n";
  print $hf "header = \"X-Upload-Key: $key\"\n";
  close $hf;
  chmod 0600, $hdr;
}

sub summary {
  my ($r) = @_;
  my $d = $r->{data};
  my $last;
  for my $t (@{ $d->{tramos} }) {
    my $id = $t->{id};
    if (grep { $_->{t}{$id} && $_->{t}{$id}[0] != 0 } @{ $d->{pilotos} }) { $last = $id; }
  }
  return $d->{rally} . ' · ' . ($last ? 'hasta ' . $last : 'sin tiempos') . ' · ' . $r->{times} . ' tiempos · ' . scalar(@{ $d->{pilotos} }) . ' pilotos';
}

sub file_stat {
  my ($p) = @_;
  return undef unless defined $p && -e $p;
  my @s = stat($p);
  return undef unless @s;
  return { m => $s[9], z => $s[7] };
}

sub post_json {
  my ($json) = @_;
  my $datos = File::Spec->catfile($tmp, 'datos.json');
  my $resp  = File::Spec->catfile($tmp, 'resp.txt');
  {
    open my $df, '>:raw', $datos or die "No puedo escribir los datos\n";
    print $df $json;
    close $df;
  }
  my $url = $server . '/upload';
  my $pid = open(my $fh, '-|');
  die "No puedo lanzar curl\n" unless defined $pid;
  if ($pid == 0) {
    open STDERR, '>', File::Spec->catfile($tmp, 'curl.err');
    exec '/usr/bin/curl', '-sS', '-m', '20',
      '-o', $resp,
      '-w', '%{http_code}',
      '-K', $hdr,
      '-H', 'Content-Type: application/json',
      '--data-binary', '@' . $datos,
      $url
      or exit 127;
  }
  binmode $fh;
  local $/;
  my $out = <$fh>;
  my $ok = close $fh;
  if (!defined $out || $out eq '' || $out !~ /^\d{3}$/) {
    my $err = '';
    if (open my $ef, '<:encoding(UTF-8)', File::Spec->catfile($tmp, 'curl.err')) {
      local $/; $err = <$ef> // ''; close $ef;
    }
    die $err ne '' ? $err : "curl: error de conexión\n";
  }
  my $body = '';
  if (open my $rf, '<:raw', $resp) { local $/; $body = <$rf> // ''; close $rf; }
  $body = Encode::decode('UTF-8', $body, Encode::FB_DEFAULT) if $body ne '';
  return { status => int($out), body => $body };
}

sub parse_excel {
  my ($path) = @_;
  my $copia = File::Spec->catfile($tmp, 'copia.xlsx');
  unlink $copia if -e $copia;
  copy($path, $copia) or fail_parse("unzip: no pude copiar el Excel ($!)");
  return RallyParser::parse_file($copia);
}

sub fail_parse { die $_[0] . "\n"; }

my $st = {
  path => $excel,
  seen => undef,
  stableAt => undef,
  sentHash => undef,
  pending => undef,
  warnKey => undef,
  nextTry => 0,
  lastErr => undef,
  uploads => 0,
  sheet => undef,
};

logmsg('');
logmsg('🏁 WRS-Live · subiendo «' . basename($excel) . '»');
logmsg('   Página pública: https://blancolang-ai.github.io/wrs-live/');
logmsg('   Cada vez que guardes el Excel (⌘S) se suben los tiempos. Deja esta ventana abierta durante el rally.');
logmsg('   Para terminar: cierra esta ventana.');
logmsg('');

my $did_once_upload = 0;
for (;;) {
  my $now = now_ms();
  my $s = file_stat($st->{path});
  if (!$s) {
    if (($st->{lastErr} // '') ne 'nofile') {
      logmsg('⚠ No encuentro el Excel: ' . $st->{path} . ' (¿lo has movido o renombrado?)');
    }
    $st->{lastErr} = 'nofile';
    if ($once) { exit 1; }
    delay_s(3);
    next;
  }
  my $sig = $s->{m} . ':' . $s->{z};
  if (!defined $st->{seen} || $sig ne $st->{seen}) {
    $st->{seen} = $sig;
    $st->{stableAt} = $now + 1500;
    delay_s(1);
    next;
  }
  if (defined $st->{stableAt} && $now >= $st->{stableAt}) {
    $st->{stableAt} = undef;
    my $r = eval { parse_excel($st->{path}) };
    if ($@) {
      my $msg = $@; $msg =~ s/\s+$//;
      logmsg('⚠ No puedo leer el Excel (' . $msg . '). Lo reintento al volver a guardar.');
      $st->{lastErr} = 'parse';
      if ($msg =~ /zip|unzip|End-of-central|cannot find/i) { $st->{seen} = undef; }
      if ($once) { exit 1; }
    } else {
      if ($r->{sheet} && ($st->{sheet} // '') ne $r->{sheet}) {
        logmsg('📄 Usando la pestaña «' . $r->{sheet} . '»');
        $st->{sheet} = $r->{sheet};
      }
      my $wk = join("\n", @{ $r->{warnings} });
      if (($st->{warnKey} // '') ne $wk) {
        $st->{warnKey} = $wk;
        for my $w (@{ $r->{warnings} }) { logmsg('  ⚠ ' . $w); }
      }
      my $json = RallyParser::encode_json_utf8($r->{data});
      my $h = sha1_hex($json) . ':' . length($json);
      if (!defined $st->{sentHash} || $h ne $st->{sentHash}) {
        $st->{pending} = { json => $json, hash => $h, sum => summary($r) };
        $st->{nextTry} = 0;
      } elsif (!$st->{pending}) {
        logmsg('Guardado sin cambios en los tiempos (' . hhmmss($now) . ')');
        exit 0 if $once;
      }
    }
  }
  if ($st->{pending} && $now >= $st->{nextTry}) {
    my $res;
    my $err;
    eval { $res = post_json($st->{pending}{json}); 1; } or do { $err = $@; };
    if ($res && $res->{status} == 200) {
      $st->{sentHash} = $st->{pending}{hash};
      $st->{uploads}++;
      logmsg('✅ Subido ' . hhmmss($now) . ' · ' . $st->{pending}{sum});
      $st->{pending} = undef;
      $st->{lastErr} = undef;
      $did_once_upload = 1;
      exit 0 if $once;
    } elsif ($res && ($res->{status} == 401 || $res->{status} == 403)) {
      logmsg('⛔ El servidor rechaza la clave (clave.txt). No se reintenta hasta volver a guardar. ' . ($res->{body} // ''));
      $st->{pending} = undef;
      $st->{lastErr} = 'key';
      exit 1 if $once;
    } elsif ($res && ($res->{status} == 413 || $res->{status} == 422 || $res->{status} == 400)) {
      logmsg('⛔ El servidor no acepta los datos (' . $res->{status} . '): ' . ($res->{body} // '') . '. Comprueba que cada piloto tiene un dorsal numérico único y que los tiempos, C, T y penalizaciones son números. Corrige el Excel y vuelve a guardar.');
      $st->{pending} = undef;
      $st->{lastErr} = 'data';
      exit 1 if $once;
    } else {
      my $why = $err ? 'sin conexión' : 'error del servidor ' . ($res && $res->{status});
      logmsg('… ' . $why . ' (' . hhmmss($now) . '). Reintento en 5 s; no cierres esta ventana.');
      $st->{nextTry} = $now + 5000;
      $st->{lastErr} = 'net';
      if ($once) {
        # --once also retries network a few times so a brief blip doesn't fail the test
        if (($st->{_onceTries} // 0) >= 3) { exit 1; }
        $st->{_onceTries} = ($st->{_onceTries} // 0) + 1;
      }
    }
  }
  my $w = $st->{pending} ? 1 : 2;
  delay_s($w);
}
