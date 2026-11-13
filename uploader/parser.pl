# Rally Directo · lector de la hoja del rally (.xlsx) para Perl 5.18 (el de macOS 10.13+).
# Solo módulos CORE y /usr/bin/unzip. Salida: SOLO los datos públicos del rally + avisos.
# Si no se indica una hoja, usa la pestaña inmediatamente anterior a «Plantilla».
# Mantiene el mismo criterio que uploader/parser.js (las pruebas comparan ambos).
package RallyParser;
use 5.018;
use strict;
use warnings;
use utf8;
use Encode qw(decode encode);
use Unicode::Normalize qw(NFD);
use JSON::PP;

sub fail { die $_[0] . "\n"; }

sub xml_decode {
  my ($s) = @_;
  return $s if !defined $s;
  $s =~ s/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/
    $1 eq 'lt' ? '<' :
    $1 eq 'gt' ? '>' :
    $1 eq 'amp' ? '&' :
    $1 eq 'quot' ? '"' :
    $1 eq 'apos' ? "'" :
    index($1, '#x') == 0 ? chr(hex(substr($1, 2))) :
    chr(substr($1, 1))
  /eg;
  return $s;
}

sub attr {
  my ($tag, $name) = @_;
  return $tag =~ /\s\Q$name\E="([^"]*)"/ ? xml_decode($1) : undef;
}

sub texts {
  my ($xml) = @_;
  my $out = '';
  while ($xml =~ /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g) {
    $out .= defined $1 ? xml_decode($1) : '';
  }
  return $out;
}

sub col_index {
  my ($ref) = @_;
  my ($c) = $ref =~ /^([A-Z]+)/;
  my $n = 0;
  for my $ch (split //, $c) { $n = $n * 26 + (ord($ch) - 64); }
  return $n - 1;
}

sub fold_name {
  my ($s) = @_;
  $s = '' if !defined $s;
  $s =~ s/\s+/ /g;
  $s =~ s/^\s+|\s+$//g;
  $s = lc $s;
  $s = NFD($s);
  $s =~ s/\pM//g;
  return $s;
}

sub is_plantilla { fold_name($_[0]) eq 'plantilla' }

sub list_sheets {
  my ($wb) = @_;
  my @names;
  while ($wb =~ /<sheet\s[^>]*>/g) { push @names, (attr($&, 'name') // ''); }
  return @names;
}

# Elige la pestaña del directo: la anterior a «Plantilla».
sub pick_live_sheet {
  my (@names) = @_;
  fail('El libro no tiene hojas') unless @names;
  return { name => $names[0] } if @names == 1;
  my $pi = -1;
  for my $i (0 .. $#names) { if (is_plantilla($names[$i])) { $pi = $i; last; } }
  if ($pi == 0) {
    fail('La pestaña «Plantilla» es la primera del libro; el programa usa la pestaña anterior a «Plantilla». Pon el rally justo antes de «Plantilla».');
  }
  if ($pi < 0) {
    return { name => $names[-1], warning => 'El libro no tiene pestaña «Plantilla»; se usa la última («' . $names[-1] . '»)' };
  }
  return { name => $names[$pi - 1] };
}

sub unzip_xml {
  my ($xlsx, $member) = @_;
  my $pid = open(my $fh, '-|');
  return undef unless defined $pid;
  if ($pid == 0) {
    open STDERR, '>', '/dev/null';
    exec '/usr/bin/unzip', '-p', '-qq', $xlsx, $member or exec '/usr/bin/unzip', '-p', $xlsx, $member or exit 127;
  }
  binmode $fh;
  local $/;
  my $data = <$fh>;
  my $ok = close $fh;
  return undef if !defined $data || $data eq '';
  $data =~ s/^\xEF\xBB\xBF//;
  return decode('UTF-8', $data);
}

sub getxml_for {
  my ($xlsx) = @_;
  return sub { unzip_xml($xlsx, $_[0]) };
}

sub mknum { bless { v => 0 + $_[0] }, 'RallyParser::Num' }

sub is_str { defined $_[0] && !ref($_[0]) }
sub is_num { defined $_[0] && ref($_[0]) && ref($_[0]) eq 'RallyParser::Num' }
sub is_err { defined $_[0] && ref($_[0]) eq 'HASH' && exists $_[0]{err} }
sub nval { is_num($_[0]) ? $_[0]{v} : $_[0] }

sub is_finite_num {
  return 0 unless is_num($_[0]);
  my $v = $_[0]{v};
  return 0 if $v eq 'nan' || $v ne $v; # NaN
  return 0 if $v =~ /^(?:inf|-inf)$/i;
  return 1;
}

sub parse_float_str {
  my ($s) = @_;
  return undef if !defined $s || $s eq '';
  return 0 + $s if $s =~ /^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/;
  return undef;
}

sub read_sheet {
  my ($getXml, $wanted) = @_;
  my $wb = $getXml->('xl/workbook.xml');
  fail('No es un archivo .xlsx válido (falta workbook.xml)') unless defined $wb && $wb ne '';
  my $pickWarn;
  if (!defined $wanted || $wanted eq '') {
    my $pick = pick_live_sheet(list_sheets($wb));
    $wanted = $pick->{name};
    $pickWarn = $pick->{warning};
  }
  my $sh;
  while ($wb =~ /<sheet\s[^>]*>/g) {
    if (!$sh && attr($&, 'name') eq $wanted) { $sh = $&; last; }
  }
  if (!$sh) {
    fail($wanted ? "No existe la hoja «$wanted»" : 'El libro no tiene hojas');
  }
  my $sheetName = attr($sh, 'name');
  my $rid = attr($sh, 'r:id');
  my $nSheets = () = $wb =~ /<sheet\s/g;
  my $rels = $getXml->('xl/_rels/workbook.xml.rels') // '';
  my $target;
  while ($rels =~ /<Relationship\s[^>]*>/g) {
    if (attr($&, 'Id') eq $rid) { $target = attr($&, 'Target'); last; }
  }
  $target = 'worksheets/sheet1.xml' unless defined $target && $target ne '';
  my $path;
  if (substr($target, 0, 1) eq '/') { $path = substr($target, 1); }
  else { ($path = $target) =~ s/^\.\///; $path = 'xl/' . $path; }

  my $ssx = $getXml->('xl/sharedStrings.xml') // '';
  my @ss;
  while ($ssx =~ /<si>([\s\S]*?)<\/si>|<si\/>/g) {
    push @ss, defined $1 ? texts($1) : '';
  }
  my $xml = $getXml->($path);
  fail('No se encuentra la hoja ' . $path) unless defined $xml;
  my @rows;
  while ($xml =~ /<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g) {
    my $rattr = $1;
    my $body = $2;
    my $rn = int(attr(' ' . $rattr, 'r')) - 1;
    my @cells;
    if (defined $body && $body ne '') {
      while ($body =~ /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g) {
        my $a = ' ' . $1;
        my $cbody = $2 // '';
        my $ref = attr($a, 'r');
        next unless defined $ref;
        my $t = attr($a, 't');
        my $vm = ($cbody =~ /<v>([\s\S]*?)<\/v>/) ? $1 : undef;
        my $v;
        if (defined $t && $t eq 's') {
          $v = defined $vm ? $ss[int($vm)] : undef;
        } elsif (defined $t && $t eq 'inlineStr') {
          $v = texts($cbody);
        } elsif (defined $t && $t eq 'str') {
          $v = defined $vm ? xml_decode($vm) : undef;
        } elsif (defined $t && $t eq 'b') {
          $v = defined $vm && $vm eq '1' ? JSON::PP::true : JSON::PP::false;
        } elsif (defined $t && $t eq 'e') {
          $v = defined $vm ? { err => xml_decode($vm) } : undef;
        } else {
          $v = defined $vm ? mknum(0 + $vm) : undef;
        }
        $cells[col_index($ref)] = $v;
      }
    }
    $rows[$rn] = \@cells;
  }
  for my $i (0 .. $#rows) { $rows[$i] = [] unless $rows[$i]; }
  return { name => $sheetName, rows => \@rows, nSheets => $nSheets, warning => $pickWarn };
}

sub norm {
  my ($s) = @_;
  $s = '' if !defined $s;
  $s = nval($s) if is_num($s);
  $s = "$s";
  $s =~ s/\s+/ /g;
  $s =~ s/^\s+|\s+$//g;
  return $s;
}

sub is_finite {
  my ($x) = @_;
  return 0 unless defined $x;
  return 0 if $x ne $x;
  return 0 if $x =~ /^(?:nan|inf|-inf)$/i;
  return 1;
}

sub round3 {
  my ($x) = @_;
  my $r = int($x * 1000 + ($x >= 0 ? 0.5 : -0.5)) / 1000;
  return 0 + $r;
}

sub parse_tramo {
  my ($h) = @_;
  $h = norm($h);
  my ($num, $rest) = $h =~ /^TC\s*(\d+)\s*[.\-]?\s*(.*)$/i;
  $num = int($num);
  my $ps = $rest =~ /power\s*stage/i ? 1 : 0;
  $rest =~ s/power\s*stage//ig;
  my $surf;
  if ($rest =~ /\(([^)]*)\)/) {
    my $pre = substr($rest, 0, $-[0]);
    my $post = substr($rest, $+[0]);
    $surf = $1;
    $surf =~ s/^\s+|\s+$//g;
    $surf = undef if $surf eq '';
    $rest = $pre . $post;
  }
  my $km;
  if ($rest =~ /(\d+(?:[.,]\d+)?)\s*k\s*m\.?/i) {
    my $pre = substr($rest, 0, $-[0]);
    my $post = substr($rest, $+[0]);
    my $n = $1; $n =~ s/,/./;
    $km = 0 + $n;
    $rest = $pre . $post;
  }
  $rest =~ s/^[\s.\-]+//;
  $rest =~ s/[\s.\-]+$//;
  $rest =~ s/^\s+|\s+$//g;
  return { num => $num, name => $rest, km => $km, ps => $ps, surf => $surf };
}

my $KNOWN = qr/^(Pos\.|Dorsal|Piloto|Coche|Categoría|Pesos|Incidencias acumuladas|C\.|T\.|Suma|SUMA .*|Total Rally.*|Dif\. Ant\.|Dif\.1º\.|Penalizaciones)$/i;

# Fecha Excel: serial 0 = 1899-12-30, como Date.UTC(1899,11,30) + serial*86400000 en JS.
sub _is_leap {
  my ($y) = @_;
  return ($y % 4 == 0 && $y % 100 != 0) || ($y % 400 == 0);
}
sub excel_date {
  my ($v) = @_;
  my $serial = int($v + ($v >= 0 ? 0.5 : -0.5));
  my $z = $serial - 25569; # días desde 1970-01-01
  my $wday = (4 + $z) % 7; # 1970-01-01 fue jueves = 4 (domingo=0)
  $wday += 7 while $wday < 0;
  my $y = 1970;
  if ($z >= 0) {
    while (1) {
      my $yd = _is_leap($y) ? 366 : 365;
      last if $z < $yd;
      $z -= $yd;
      $y++;
    }
  } else {
    while ($z < 0) {
      $y--;
      $z += _is_leap($y) ? 366 : 365;
    }
  }
  my @md = (31, (_is_leap($y) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31);
  my $m = 0;
  while ($m < 12 && $z >= $md[$m]) { $z -= $md[$m]; $m++; }
  return { y => $y, m => $m, d => $z + 1, wd => ($wday + 6) % 7 };
}

sub _cell {
  my ($rows, $r, $c) = @_;
  return undef if $c < 0 || $r < 0;
  return undef unless $rows->[$r];
  return $rows->[$r][$c];
}

sub parse {
  my ($getXml, $opts) = @_;
  $opts ||= {};
  my $sheet = read_sheet($getXml, $opts->{sheet});
  my $rows = $sheet->{rows};
  my @warn;
  push @warn, $sheet->{warning} if $sheet->{warning};

  my ($venue, $date);
  my $row1 = $rows->[1] || [];
  for my $v (@$row1) {
    if (is_num($v) && is_finite_num($v) && $v->{v} > 20000 && $v->{v} < 80000 && !$date) {
      $date = excel_date($v->{v});
    } elsif (is_str($v) && $v =~ /\S/ && !defined $venue && index($v, 'Indid') < 0 && index($v, 'Leyenda') < 0) {
      my $t = $v; $t =~ s/^\s+|\s+$//g;
      $venue = $t;
    }
  }

  my @sections;
  my $rallyName;
  for my $i (0 .. $#$rows) {
    my $a = _cell($rows, $i, 0);
    next unless is_str($a) && $a =~ /^\s*Rally\b.*D[ií]a\s*\d/;
    my $title = norm($a);
    my ($dayN, $part) = $title =~ /D[ií]a\s*(\d+)\s*(?:\(([^)]*)\))?/;
    $rallyName = $rallyName || norm((split /\./, $title)[0]);
    my $hi = -1;
    my $kmax = $i + 12; $kmax = $#$rows if $kmax > $#$rows;
    for my $k ($i + 1 .. $kmax) {
      my $h0 = _cell($rows, $k, 0);
      if (defined $h0 && norm($h0) eq 'Pos.') { $hi = $k; last; }
    }
    if ($hi < 0) {
      push @warn, $title . ': no encuentro la fila de cabecera «Pos.»; se ignora la sección';
      next;
    }
    my $hr = $rows->[$hi] || [];
    my @h;
    for my $j (0 .. $#$hr) { $h[$j] = defined $hr->[$j] ? norm($hr->[$j]) : ''; }
    my $col = sub {
      my ($name) = @_;
      my $ln = lc $name;
      for my $j (0 .. $#h) { return $j if lc($h[$j]) eq $ln; }
      return undef;
    };
    my $cD = $col->('Dorsal');
    my $cP = $col->('Piloto');
    my $cC = $col->('Coche');
    my $cCat = $col->('Categoría');
    my $cPen = $col->('Penalizaciones');
    if (!defined $cP) {
      push @warn, $title . ': sin columna «Piloto»; se ignora la sección';
      next;
    }
    my @tramos;
    for my $j (0 .. $#h) {
      my $v = $h[$j];
      if ($v =~ /^TC\s*\d+/i) {
        my $pt = parse_tramo($hr->[$j]);
        my $cc = (defined $h[$j + 1] && $h[$j + 1] eq 'C.') ? $j + 1 : undef;
        my $ct = (defined $h[$j + 2] && $h[$j + 2] eq 'T.') ? $j + 2 : undef;
        if (!defined $cc || !defined $ct) {
          push @warn, $title . ': TC' . $pt->{num} . ' sin columnas C./T.';
        }
        $pt->{label} = norm($hr->[$j]);
        $pt->{cT} = $j;
        $pt->{cC} = $cc;
        $pt->{cTe} = $ct;
        push @tramos, $pt;
      } elsif ($v && $v !~ $KNOWN) {
        push @warn, $title . ': columna no reconocida «' . $v . '» (se ignora)';
      }
    }
    my @drivers;
    for my $r2i ($hi + 1 .. $#$rows) {
      my $r2 = $rows->[$r2i] || [];
      my $a2 = $r2->[0];
      if (is_str($a2) && ($a2 =~ /^\s*(Rally|Total)/ || norm($a2) eq 'Pos.')) { last; }
      my $nm = defined $cP ? $r2->[$cP] : undef;
      next unless is_str($nm) && $nm =~ /\S/;
      my $cellT = sub {
        my ($x, $where) = @_;
        return undef if !defined $x || (is_str($x) && $x eq '');
        return nval($x) if is_num($x);
        if (is_err($x)) {
          push @warn, $where . ': error «' . $x->{err} . '» en la celda; se ignora';
          return undef;
        }
        if (is_str($x)) {
          if ($x =~ /^\s*(DNF|AB\.?|ABANDONO)\s*$/i) {
            push @warn, $where . ': texto «' . (norm($x) eq '' ? $x : do { my $t = $x; $t =~ s/^\s+|\s+$//g; $t }) . '»; se trata como abandono (999)';
            return 999;
          }
          my $raw = $x; $raw =~ s/^\s+|\s+$//g;
          my $tmp = $x; $tmp =~ s/,/./;
          my $f = parse_float_str($tmp);
          if ($x =~ /^\s*\d+([.,]\d+)?\s*$/ && defined $f && is_finite($f)) {
            push @warn, $where . ': tiempo escrito como texto «' . $raw . '»';
            return $f;
          }
          push @warn, $where . ': texto «' . $raw . '» en una celda de tiempo; se ignora';
          return undef;
        }
        return undef;
      };
      my $cellN = sub {
        my ($x, $where) = @_;
        return 0 if !defined $x || (is_str($x) && $x eq '');
        return nval($x) if is_num($x);
        if (is_err($x)) {
          push @warn, $where . ': error «' . $x->{err} . '»; se toma 0';
          return 0;
        }
        my $tmp = "$x"; $tmp =~ s/,/./;
        my $f = parse_float_str($tmp);
        return defined $f && is_finite($f) ? $f : 0;
      };
      my $nmTrim = $nm; $nmTrim =~ s/^\s+|\s+$//g;
      my $who = $title . ' · ' . $nmTrim;
      my $dorsal;
      if (defined $cD) {
        my $dv = $r2->[$cD];
        if (is_num($dv) && is_finite_num($dv)) { $dorsal = nval($dv); }
        elsif (defined $dv && !(is_str($dv) && $dv =~ /^\s*$/)) {
          my $s = is_num($dv) ? nval($dv) : "$dv";
          $s =~ s/^\s+|\s+$//g;
          if ($s ne '' && $s =~ /^-?\d+(\.\d+)?$/ && is_finite(0 + $s)) { $dorsal = 0 + $s; }
          else { $dorsal = undef; }
        } else { $dorsal = undef; }
      } else { $dorsal = undef; }
      my $coche = (defined $cC && defined $r2->[$cC]) ? norm($r2->[$cC]) : '';
      my $cat;
      if (defined $cCat && defined $r2->[$cCat] && norm($r2->[$cCat]) ne '') { $cat = norm($r2->[$cCat]); }
      else { $cat = undef; }
      my $pen = defined $cPen ? $cellN->($r2->[$cPen], $who . ' · Penalizaciones') : 0;
      my @t;
      for my $t (@tramos) {
        my $w = $who . ' · TC' . $t->{num};
        push @t, [
          $cellT->($r2->[$t->{cT}], $w),
          defined $t->{cC} ? $cellN->($r2->[$t->{cC}], $w . ' C.') : 0,
          defined $t->{cTe} ? $cellN->($r2->[$t->{cTe}], $w . ' T.') : 0,
        ];
      }
      push @drivers, { dorsal => $dorsal, nombre => $nmTrim, coche => $coche, cat => $cat, pen => $pen, t => \@t };
    }
    $part = defined $part ? $part : '';
    $part =~ s/^\s+|\s+$//g;
    push @sections, { title => $title, day => int($dayN), part => $part, tramos => \@tramos, drivers => \@drivers, hasCat => defined $cCat ? 1 : 0 };
  }
  fail('No encuentro ninguna sección «Rally … Día N» en la hoja «' . $sheet->{name} . '»') unless @sections;

  my @nums;
  for my $s (@sections) { for my $t (@{ $s->{tramos} }) { push @nums, $t->{num}; } }
  my $renum = 0;
  for my $i (0 .. $#nums) { $renum = 1 if $nums[$i] != $i + 1; }
  if ($renum) {
    my %seen; my @rep;
    for my $n (@nums) { if ($seen{$n}) { push @rep, $n; } $seen{$n} = 1; }
    my $msg = 'Numeración de tramos irregular en el Excel [' . join(', ', @nums) . ']';
    $msg .= ' (repetidos: TC' . join(', TC', @rep) . ')' if @rep;
    $msg .= '; la web los numera TC1..TC' . scalar(@nums) . ' en orden de columnas';
    push @warn, $msg;
  }

  my @days;
  for my $s (@sections) {
    push @days, $s->{day} unless grep { $_ == $s->{day} } @days;
  }
  @days = sort { $a <=> $b } @days;

  my @outSecs; my @outT; my %pil; my @order; my $kk = 0;
  for my $si (0 .. $#sections) {
    my $s = $sections[$si];
    my $name = 'Día ' . $s->{day};
    if ($s->{part} ne '') {
      my $p = $s->{part};
      my $first = substr($p, 0, 1);
      my $rest = length($p) > 1 ? substr($p, 1) : '';
      $name .= ' ' . uc($first) . lc($rest);
    }
    my @ids;
    for my $t (@{ $s->{tramos} }) {
      $kk++;
      my $tid = $renum ? 'TC' . $kk : 'TC' . $t->{num};
      push @outT, { id => $tid, name => ($t->{name} ne '' ? $t->{name} : $t->{label}), km => $t->{km}, ps => ($t->{ps} ? JSON::PP::true : JSON::PP::false), surf => $t->{surf}, sec => 0 + $si };
      push @ids, $tid;
    }
    my $dayIdx = 0;
    for my $di (0 .. $#days) { if ($days[$di] == $s->{day}) { $dayIdx = $di; last; } }
    push @outSecs, { id => 's' . $si, name => $name, day => 0 + $dayIdx, tramos => \@ids };
    for my $d (@{ $s->{drivers} }) {
      my $key = defined $d->{dorsal} ? 'd' . $d->{dorsal} : 'n' . lc($d->{nombre});
      if (!$pil{$key}) {
        $pil{$key} = { dorsal => $d->{dorsal}, nombre => $d->{nombre}, coche => $d->{coche}, cat => $d->{cat}, t => {}, pen => [ (0) x scalar(@sections) ] };
        push @order, $key;
      }
      my $p = $pil{$key};
      if (lc($d->{nombre}) ne lc($p->{nombre})) {
        push @warn, 'Dorsal ' . $d->{dorsal} . ': «' . $p->{nombre} . '» en la 1ª sección pero «' . $d->{nombre} . '» en ' . $name;
      }
      if (!$p->{cat} && $d->{cat}) { $p->{cat} = $d->{cat}; }
      $p->{pen}[$si] = round3($d->{pen} || 0);
      for my $x (0 .. $#ids) {
        my $tv = $d->{t}[$x];
        if (defined $tv->[0] && $tv->[0] > 0) {
          $p->{t}{ $ids[$x] } = [ round3($tv->[0]), int(($tv->[1] || 0) + (($tv->[1] || 0) >= 0 ? 0.5 : -0.5)), int(($tv->[2] || 0) + (($tv->[2] || 0) >= 0 ? 0.5 : -0.5)) ];
        }
      }
    }
  }

  my @pilotos = map { $pil{$_} } @order;
  my @noDorsal = grep { !defined $_->{dorsal} } @pilotos;
  if (@noDorsal) {
    push @warn, 'Pilotos sin dorsal: ' . join(', ', map { $_->{nombre} } @noDorsal) . ' (se les asigna uno provisional)';
  }
  my $maxD = 0;
  for my $p (@pilotos) { my $d = $p->{dorsal} || 0; $maxD = $d if $d > $maxD; }
  for my $x (0 .. $#noDorsal) { $noDorsal[$x]{dorsal} = 1000 + $maxD + $x; }
  if (@outT && !grep { $_->{ps} } @outT) {
    push @warn, 'Ningún tramo marcado como POWER STAGE';
  }
  my @cats;
  for my $p (@pilotos) {
    push @cats, $p->{cat} if $p->{cat} && !grep { $_ eq $p->{cat} } @cats;
  }
  @cats = sort @cats;
  if (!@cats) {
    push @warn, 'Sin columna Categoría (formato antiguo): se trata como una sola categoría';
    for my $p (@pilotos) { $p->{cat} = 'Rally1'; }
    @cats = ('Rally1');
  } else {
    my @odd = grep { $_ ne 'Rally1' && $_ ne 'Rally2' } @cats;
    if (@odd) {
      push @warn, 'Categorías no previstas: ' . join(', ', @odd) . ' (se muestran con el color de Rally2)';
    }
    my @sinCat = grep { !$_->{cat} } @pilotos;
    if (@sinCat) {
      push @warn, 'Sin categoría: ' . join(', ', map { $_->{nombre} } @sinCat) . ' (se pone Rally1)';
      for my $p (@sinCat) { $p->{cat} = 'Rally1'; }
      unshift @cats, 'Rally1' unless grep { $_ eq 'Rally1' } @cats;
    }
  }
  my $times = 0;
  for my $p (@pilotos) { $times += scalar keys %{ $p->{t} }; }
  push @warn, 'La hoja no tiene tiempos todavía' unless $times;

  my @wd = ('LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM');
  my @wdl = ('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo');
  my @meses = ('ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic');
  my @dayLabels;
  for my $x (0 .. $#days) {
    my $d = $days[$x];
    if ($date) {
      my $w = (($date->{wd} - ($#days - $x)) % 7 + 7) % 7;
      push @dayLabels, { short => $wd[$w], long => $wdl[$w] . ' · Día ' . $d };
    } else {
      push @dayLabels, { short => 'D' . $d, long => 'Día ' . $d };
    }
  }
  my $data = {
    format => 1,
    champ => ($opts->{champ} || 'WRSlot Cantabria'),
    rally => $rallyName,
    venue => $venue,
    date => ($date ? $date->{d} . ' ' . $meses[$date->{m}] : ''),
    sections => \@outSecs,
    tramos => \@outT,
    pilotos => \@pilotos,
    cats => \@cats,
    dayLabels => \@dayLabels,
  };
  return { data => $data, warnings => \@warn, sheet => $sheet->{name}, times => 0 + $times };
}

sub parse_file {
  my ($xlsx, $opts) = @_;
  fail('No es un archivo .xlsx válido (unzip no pudo leer el archivo)') unless defined $xlsx && -f $xlsx;
  return parse(getxml_for($xlsx), $opts);
}

sub encode_json_utf8 {
  my ($obj) = @_;
  return JSON::PP->new->utf8->ascii(0)->allow_nonref->canonical(0)->encode($obj);
}

if (!caller) {
  binmode STDOUT, ':raw';
  binmode STDERR, ':encoding(UTF-8)';
  my $sheet;
  my $file;
  while (@ARGV) {
    my $a = shift @ARGV;
    if ($a eq '--sheet') { $sheet = shift @ARGV; }
    else { $file = $a; }
  }
  fail('Uso: parser.pl [--sheet NOMBRE] archivo.xlsx') unless $file;
  my $opts = {};
  $opts->{sheet} = $sheet if defined $sheet && $sheet ne '';
  my $r = eval { parse_file($file, $opts) };
  if ($@) {
    my $m = $@; $m =~ s/\s+$//;
    print STDERR $m, "\n";
    exit 1;
  }
  print encode_json_utf8($r);
}

1;
