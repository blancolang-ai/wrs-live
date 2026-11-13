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

# Entero o texto con pinta de número («12», « 12», «12.0», «#12») → entero; si no, undef.
sub parse_dorsal {
  my ($v) = @_;
  return undef if !defined $v || (is_str($v) && $v eq '');
  return undef if is_err($v);
  my $n;
  if (is_num($v)) { $n = nval($v); }
  else {
    my $s = is_num($v) ? nval($v) : "$v";
    $s =~ s/\s+//g;
    return undef if $s eq '';
    $s =~ s/,/./;
    $s =~ s/^[^0-9.+-]+//;
    return undef unless $s =~ /^[+-]?\d+(?:\.\d+)?$/;
    $n = 0 + $s;
  }
  return undef unless is_finite($n) && $n >= 0;
  my $i = int($n + 0.5);
  return undef if abs($n - $i) > 1e-6;
  return 0 + $i;
}
sub clip {
  my ($s, $max) = @_;
  return $s if !defined $s;
  $s = "$s";
  return length($s) > $max ? substr($s, 0, $max) : $s;
}
sub as_num {
  my ($v) = @_;
  return nval($v) if is_num($v);
  return 0 + $v if defined $v && !ref($v) && $v =~ /^-?\d+(?:\.\d+)?$/ && is_finite(0 + $v);
  return undef if !defined $v || (is_str($v) && $v eq '');
  my $s = "$v"; $s =~ s/,/./;
  my $n = parse_float_str($s);
  return defined $n && is_finite($n) ? $n : undef;
}
# Recorta y tipa para que el Worker nunca responda 422.
sub fit_worker {
  my ($data, $warn) = @_;
  if (@{ $data->{sections} } > 20) {
    push @$warn, 'Demasiadas secciones (' . scalar(@{ $data->{sections} }) . '); se suben las 20 primeras';
    @{ $data->{sections} } = @{ $data->{sections} }[0 .. 19];
  }
  if (@{ $data->{tramos} } > 60) {
    push @$warn, 'Demasiados tramos (' . scalar(@{ $data->{tramos} }) . '); se suben los 60 primeros';
    @{ $data->{tramos} } = @{ $data->{tramos} }[0 .. 59];
  }
  for my $si (0 .. $#{ $data->{sections} }) {
    my $sec = $data->{sections}[$si];
    $sec->{id} = clip($sec->{id} || ('s' . $si), 10);
    $sec->{name} = clip($sec->{name} || '', 60);
    my $day = as_num($sec->{day});
    $sec->{day} = defined $day ? 0 + $day : 0 + $si;
    $sec->{tramos} = [] unless ref($sec->{tramos}) eq 'ARRAY';
    if (@{ $sec->{tramos} } > 40) { @{ $sec->{tramos} } = @{ $sec->{tramos} }[0 .. 39]; }
  }
  my $secN = scalar @{ $data->{sections} };
  my @tr;
  for my $t (@{ $data->{tramos} }) {
    $t->{id} = clip($t->{id}, 10);
    next unless $t->{id};
    $t->{name} = clip($t->{name} || '', 80);
    $t->{km} = as_num($t->{km});
    $t->{ps} = $t->{ps} ? JSON::PP::true : JSON::PP::false;
    $t->{surf} = (!defined $t->{surf} || $t->{surf} eq '') ? undef : clip("$t->{surf}", 30);
    my $sec = as_num($t->{sec});
    $t->{sec} = defined $sec ? 0 + $sec : 0;
    if ($t->{sec} < 0 || $t->{sec} >= $secN) { push @$warn, 'Tramo ' . $t->{id} . ': sección fuera de rango; se ignora'; next; }
    push @tr, $t;
  }
  $data->{tramos} = \@tr;
  my %ids = map { $_->{id} => 1 } @tr;
  my %seen; my @keep;
  for my $p (@{ $data->{pilotos} }) {
    my $d = parse_dorsal($p->{dorsal});
    next unless defined $d;
    my $nombre = defined $p->{nombre} ? $p->{nombre} : '';
    $nombre =~ s/^\s+|\s+$//g;
    next if $nombre eq '';
    if ($seen{$d}) { push @$warn, 'Dorsal ' . $d . ' repetido («' . $nombre . '»); se ignora el duplicado'; next; }
    $seen{$d} = 1;
    my %t;
    my $src = $p->{t} || {};
    for my $k (keys %$src) {
      next unless $ids{$k} && $src->{$k};
      my $a = $src->{$k};
      my $t0 = as_num($a->[0]); next unless defined $t0;
      my $c = as_num($a->[1]); my $te = as_num($a->[2]);
      $t{$k} = [ $t0, defined $c ? int(($c >= 0 ? $c : 0) + 0.5) : 0, defined $te ? int(($te >= 0 ? $te : 0) + 0.5) : 0 ];
    }
    my @pen;
    if (ref($p->{pen}) eq 'ARRAY') {
      for my $x (@{ $p->{pen} }) { my $n = as_num($x); push @pen, defined $n ? $n : 0; }
      @pen = @pen[0 .. 19] if @pen > 20;
    }
    push @keep, { dorsal => 0 + $d, nombre => clip($nombre, 60), coche => clip($p->{coche} || '', 80), cat => (clip($p->{cat} || 'Rally1', 20) || 'Rally1'), t => \%t, pen => \@pen };
  }
  if (@keep > 200) { push @$warn, 'Demasiados pilotos (' . scalar(@keep) . '); se suben los 200 primeros'; @keep = @keep[0 .. 199]; }
  $data->{pilotos} = \@keep;
  $data->{champ} = clip($data->{champ}, 80);
  $data->{rally} = clip($data->{rally}, 80);
  $data->{venue} = defined $data->{venue} ? clip($data->{venue}, 80) : $data->{venue};
  $data->{date} = clip($data->{date} || '', 20);
  if (exists $data->{season} && defined $data->{season} && $data->{season} ne '') {
    my $sy = as_num($data->{season});
    if (defined $sy && $sy >= 2000 && $sy <= 2100) { $data->{season} = int($sy + ($sy >= 0 ? 0.5 : -0.5)); }
    else { delete $data->{season}; }
  } else {
    delete $data->{season} if exists $data->{season};
  }
  if (@{ $data->{cats} } > 6) { push @$warn, 'Demasiadas categorías; se suben las 6 primeras'; @{ $data->{cats} } = @{ $data->{cats} }[0 .. 5]; }
  $data->{cats} = [ map { clip($_, 20) } @{ $data->{cats} } ];
  if (@{ $data->{dayLabels} } > 10) { @{ $data->{dayLabels} } = @{ $data->{dayLabels} }[0 .. 9]; }
  for my $d (@{ $data->{dayLabels} }) { $d->{short} = clip($d->{short} || '', 6); $d->{long} = clip($d->{long} || '', 40); }
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

my $KNOWN = qr/^(Pos\.|Dorsal|Piloto|Coche|Categoría|Pesos|Incidencias acumuladas|C\.?|T\.?|Costados?|Techos?|Suma|SUMA .*|Total Rally.*|Dif\. Ant\.|Dif\.1º\.|Penalizaciones)$/i;

sub ct_key {
  my ($v) = @_;
  my $s = lc norm($v);
  $s =~ s/[.\x{00B7}\x{2022}\x{FF0E}]//g;
  $s =~ s/\s+//g;
  return $s;
}
sub is_c_hdr { my $s = ct_key($_[0]); return $s eq 'c' || $s eq 'costado' || $s eq 'costados'; }
sub is_t_hdr { my $s = ct_key($_[0]); return $s eq 't' || $s eq 'techo' || $s eq 'techos'; }
sub is_other_hdr {
  my ($v) = @_;
  $v = norm($v);
  return 0 if $v eq '';
  return 1 if $v =~ /^TC\s*\d+/i;
  return 1 if $v =~ $KNOWN && !is_c_hdr($v) && !is_t_hdr($v);
  return 0;
}
sub ct_cols {
  my ($h, $j) = @_;
  my $n1 = defined $h->[$j + 1] ? $h->[$j + 1] : '';
  my $n2 = defined $h->[$j + 2] ? $h->[$j + 2] : '';
  my $cc = is_c_hdr($n1) ? $j + 1 : undef;
  my $ct = is_t_hdr($n2) ? $j + 2 : undef;
  $cc = $j + 2 if !defined $cc && is_c_hdr($n2);
  $ct = $j + 1 if !defined $ct && is_t_hdr($n1);
  if (!defined $cc && !defined $ct && !is_other_hdr($n1) && !is_other_hdr($n2)) {
    $cc = $j + 1; $ct = $j + 2;
  }
  return ($cc, $ct);
}

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


sub season_year {
  my ($s) = @_;
  return undef unless defined $s && !ref($s);
  return 0 + $1 if $s =~ /temporada\s*[:.\-]?\s*(20\d{2})/i;
  return undef;
}
sub season_from_rows {
  my ($rows, $sheet_name) = @_;
  my $y = season_year($sheet_name);
  return $y if defined $y;
  my $n = @$rows < 25 ? $#$rows : 24;
  for my $r (0 .. $n) {
    my $row = $rows->[$r] || [];
    for my $c (0 .. $#$row) {
      my $v = $row->[$c];
      next unless is_str($v);
      $y = season_year($v);
      return $y if defined $y;
    }
  }
  return undef;
}
sub season_from_book {
  my ($getXml) = @_;
  my $wb = $getXml->('xl/workbook.xml');
  return undef unless defined $wb && $wb ne '';
  my @years;
  for my $n (list_sheets($wb)) {
    my $y = season_year($n);
    push @years, $y if defined $y;
  }
  return undef unless @years;
  @years = sort { $b <=> $a } @years;
  return $years[0];
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
    my $cInc = $col->('Incidencias acumuladas');
    if (!defined $cP) {
      push @warn, $title . ': sin columna «Piloto»; se ignora la sección';
      next;
    }
    my @tramos;
    for my $j (0 .. $#h) {
      my $v = $h[$j];
      if ($v =~ /^TC\s*\d+/i) {
        my $pt = parse_tramo($hr->[$j]);
        my ($cc, $ct) = ct_cols(\@h, $j);
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
      my $cellCT = sub {
        my ($x, $where) = @_;
        return 0 if !defined $x || (is_str($x) && $x eq '');
        if (is_num($x)) { my $n = int(nval($x) + (nval($x) >= 0 ? 0.5 : -0.5)); return $n > 0 ? $n : 0; }
        if (is_err($x)) {
          push @warn, $where . ': error «' . $x->{err} . '»; se toma 0';
          return 0;
        }
        my $s = "$x"; $s =~ s/\s+//g;
        return 0 if $s eq '';
        $s =~ s/,/./;
        if ($s =~ /^\d+(?:\.\d+)?$/) {
          my $f = 0 + $s;
          return (is_finite($f) && $f > 0) ? int($f + 0.5) : 0;
        }
        return 1;
      };
      my $nmTrim = $nm; $nmTrim =~ s/^\s+|\s+$//g;
      my $dorsal = parse_dorsal(defined $cD ? $r2->[$cD] : undef);
      next unless defined $dorsal;
      my $who = $title . ' · ' . $nmTrim;
      my $coche = (defined $cC && defined $r2->[$cC]) ? norm($r2->[$cC]) : '';
      my $cat;
      if (defined $cCat && defined $r2->[$cCat] && norm($r2->[$cCat]) ne '') { $cat = norm($r2->[$cCat]); }
      else { $cat = undef; }
      my $pen = defined $cPen ? $cellN->($r2->[$cPen], $who . ' · Penalizaciones') : 0;
      my $excelAcc;
      if (defined $cInc) {
        my $xv = $r2->[$cInc];
        if (defined $xv && !(is_str($xv) && $xv eq '')) {
          if (is_num($xv)) { $excelAcc = int(nval($xv) + (nval($xv) >= 0 ? 0.5 : -0.5)); }
          elsif (!is_err($xv)) {
            my $tmp = "$xv"; $tmp =~ s/,/./;
            my $f = parse_float_str($tmp);
            $excelAcc = int($f + ($f >= 0 ? 0.5 : -0.5)) if defined $f && is_finite($f);
          }
        }
      }
      my @t;
      for my $t (@tramos) {
        my $w = $who . ' · TC' . $t->{num};
        push @t, [
          $cellT->($r2->[$t->{cT}], $w),
          defined $t->{cC} ? $cellCT->($r2->[$t->{cC}], $w . ' C.') : 0,
          defined $t->{cTe} ? $cellCT->($r2->[$t->{cTe}], $w . ' T.') : 0,
        ];
      }
      push @drivers, { dorsal => $dorsal, nombre => $nmTrim, coche => $coche, cat => $cat, pen => $pen, excelAcc => $excelAcc, t => \@t };
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
      if (defined $d->{excelAcc}) {
        my $calc = 0;
        for my $tid (keys %{ $p->{t} }) {
          my $tv = $p->{t}{$tid};
          next if !$tv || $tv->[0] == 999;
          $calc += ($tv->[1] || 0) + ($tv->[2] || 0);
        }
        if ($calc != $d->{excelAcc}) {
          push @warn, 'Dorsal ' . $d->{dorsal} . ': incidencias acumuladas Excel=' . $d->{excelAcc} . ', calculadas=' . $calc . ' (' . $name . ')';
        }
      }
    }
  }

  my @pilotos = map { $pil{$_} } @order;
  for my $p (@pilotos) {
    my $acc = 0;
    for my $t (@outT) {
      my $tid = $t->{id};
      my $tv = $p->{t}{$tid};
      next if !$tv;
      $acc += ($tv->[1] || 0) + ($tv->[2] || 0);
      last if $tv->[0] == 999;
      if ($acc >= 4) {
        push @warn, 'Dorsal ' . $p->{dorsal} . ': tiempo en ' . $tid . ' con la 4ª incidencia (abandono); la web no lo cuenta';
        last;
      }
    }
  }
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
  my $season = season_from_rows($rows, $sheet->{name}) // season_from_book($getXml);
  $season = $date->{y} if !defined $season && $date;
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
  $data->{season} = 0 + $season if defined $season;
  fit_worker($data, \@warn);
  my $times2 = 0;
  for my $p (@{ $data->{pilotos} }) { $times2 += scalar keys %{ $p->{t} }; }
  $times = $times2;
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
