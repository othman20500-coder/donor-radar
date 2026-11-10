# نقل رادار المانحين إلى Render

الكود في هذا المستودع. البيانات ليست فيه: `radar-data/` (القاعدة ونسخها) و`private/` (الفهرس والصفحة المبنية وعروض المانحين، نحو 150 ميجابايت) على قرص Render في `/data`. `scripts/render-start.cjs` يربط `private` بالقرص ويشغّل التطبيق.

## السحب من cPanel

مفتاح API في cPanel لا ينزّل ملفات، فيُرفع مؤقتًا سكربت PHP (`scripts/cpanel-exporter.php`، بعد وضع بصمة الرمز فيه) إلى مجلد باسم عشوائي في `public_html`. يرسل `private/` و`radar-data/` (دون `run/`، قفل التشغيل) سجلات مشفرة AES-256-GCM بإطارات، مفتاحها sha256 للرمز. Render يسحبها عند التشغيل إن كان القرص بلا قاعدة أو تغيّر `RADAR_IMPORT_NONCE`، ويحفظ ما استبدله في `/data/prev-*`. إن لزم السحب وفشل يخرج ولا يبدأ فارغًا. يُحذف السكربت بعد كل سحب.

## الخطوات

1. **التجربة:** رفع المُصدِّر برمز جديد. Render «New → Blueprint» على هذا المستودع، والمتغيرات: `PUBLIC_URL=https://donor-radar.onrender.com`، و`RADAR_IMPORT_URL` و`RADAR_IMPORT_TOKEN`. بعد النشر: الدخول على الرابط المؤقت والتأكد من المشاريع والعروض، ثم حذف المُصدِّر. الفريق يواصل على cPanel؛ ما يُكتب في التجربة لا يُنقل.
2. **التحويل** (بعد إبلاغ الفريق):
   1. Render «Custom Domains»: `radar.othmana.sa`.
   2. cPanel «Setup Node.js App»: إيقاف تطبيق الرادار (STOP APP)، ثم رفع المُصدِّر برمز جديد.
   3. Render: `RADAR_IMPORT_NONCE=cutover-1`، و`RADAR_IMPORT_TOKEN` الجديد، و`PUBLIC_URL=https://radar.othmana.sa`، ثم «Save, rebuild, and deploy».
   4. Cloudflare: سجل `radar` من `A 163.172.76.162` إلى `CNAME donor-radar.onrender.com` بلا وسيط.
   5. حذف المُصدِّر، و`RADAR_IMPORT_*` من Render.
3. **الرجوع:** تشغيل التطبيق على cPanel (START APP) وإعادة سجل `radar`. بيانات cPanel كما هي لحظة الإيقاف.

## ما لم يُتحقق منه

- أي نشر على Render.
- أداء رفع العروض وتنزيلها من القرص مقارنة بـcPanel.
