<?php
// مُصدِّر مؤقت لنقل رادار من cPanel إلى Render (انظر RENDER.md). يُرفع إلى مجلد باسم عشوائي
// في public_html بعد استبدال __TOKEN_SHA256__ ببصمة رمز لمرة واحدة، ويُحذف بعد السحب.
// يرسل سجلات: [طول الاسم u32][الاسم][الحجم u64 كـ u32+u32][المحتوى]، مشفرة AES-256-GCM
// بإطارات: [طول u32][iv 12][tag 16][نص مشفر]، والمفتاح sha256 للرمز.
header('Cache-Control: no-store');
$given = $_SERVER['HTTP_X_TOKEN'] ?? '';
if (strlen($given) < 32 || !hash_equals('__TOKEN_SHA256__', hash('sha256', $given))) { http_response_code(404); exit; }
set_time_limit(900);
$sources = [
  'private' => '/home/othmanas/donor-radar-v10-team/private',
  'radar-data' => '/home/othmanas/radar-data',
];
$key = hash('sha256', $given, true);
$buf = '';
$frame = function ($final = false) use (&$buf, $key) {
  while (strlen($buf) >= (4 << 20) || ($final && strlen($buf) > 0)) {
    $chunk = substr($buf, 0, 4 << 20); $buf = (string) substr($buf, 4 << 20);
    $iv = random_bytes(12); $tag = '';
    $c = openssl_encrypt($chunk, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    echo pack('N', strlen($c)) . $iv . $tag . $c; flush();
  }
};
header('Content-Type: application/octet-stream');
foreach ($sources as $prefix => $root) {
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $f) {
    if (!$f->isFile()) continue;
    $rel = $prefix . '/' . substr($f->getPathname(), strlen($root) + 1);
    if ($prefix === 'radar-data' && strpos($rel, 'radar-data/run/') === 0) continue; // قفل التشغيل
    if (preg_match('#(^|/)\.htaccess$#', $rel)) continue;
    // الملفات الصغيرة (ومنها القاعدة وملف wal) تُقرأ دفعة واحدة كي يطابق الحجم المحتوى ولو تغيّرت أثناء القراءة
    if ($f->getSize() < (64 << 20)) {
      $data = file_get_contents($f->getPathname()); $size = strlen($data);
      $buf .= pack('N', strlen($rel)) . $rel . pack('NN', intdiv($size, 4294967296), $size % 4294967296) . $data;
      $frame();
    } else {
      $size = $f->getSize(); $left = $size;
      $buf .= pack('N', strlen($rel)) . $rel . pack('NN', intdiv($size, 4294967296), $size % 4294967296);
      $h = fopen($f->getPathname(), 'rb');
      while ($left > 0 && !feof($h)) { $part = fread($h, min(1 << 20, $left)); $left -= strlen($part); $buf .= $part; $frame(); }
      fclose($h);
      if ($left > 0) $buf .= str_repeat("\0", $left); // لا يحدث لملفات العروض الثابتة؛ يحفظ تماسك الأرشيف
    }
  }
}
$frame(true);
