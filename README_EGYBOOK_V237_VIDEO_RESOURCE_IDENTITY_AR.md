# EgyBook V237 — Video Resource Identity Guard

## 1) بيانات الإصدار
- الإصدار: **V237 — Video Resource Identity Guard**.
- الإصدار الأساسي: **V236 — Bottom Navigation Hitbox Guard**.
- نطاق العمل: تدقيق استمرارية هوية الفيديو بين مشغل EgyBook الموحد، واستعادة جلسة Reels، وتجديد روابط Hovod.
- طبيعة الإصدار: إصلاحات محدودة داخل البنية القائمة؛ لا إعادة بناء للمشغل ولا إنشاء مشغل ثانٍ.

## 2) المشكلة الأولى — استعادة جلسة Reels على وسيط مختلف
كان `suspendForNavigation()` يحفظ `postId` ومصدر الفيديو ووقت التشغيل وحالة الصوت، لكن `resumeFromNavigation()` كان يتحقق من وجود مصدر وحالة مشغل مقبولة دون التحقق الكافي من أن الفيديو الحالي ما زال هو نفس المنشور/المورد المحفوظ.

إذا أُعيد استخدام عنصر `#egybookVideoPlayer` في سياق وسائط آخر أثناء تعليق Reels، كان من الممكن أن تُطبّق حالة Reels القديمة على مصدر آخر.

### الإصلاح
- إضافة الوحدة المستقلة `egybook-video-resource-identity.js`.
- مقارنة مصدر التشغيل الحالي بالمصدر المحفوظ باستخدام هوية المورد، وليس النص الحرفي للرابط فقط.
- مطابقة `postId` المحفوظ مع `modal.dataset.postId`.
- عند عدم التطابق: إلغاء انتقال الفيديو القديم، إيقاف الوسيط الموجود، إسقاط Lease الاستعادة القديم، وإبقاء النافذة مخفية؛ ثم يواصل منسق Reels مسار فتح مصدر Reels الطبيعي.
- عند تطابق المورد مع اختلاف تذكرة Hovod، تُقبل الاستعادة لأن `playbackId` ما زال نفسه.

## 3) المشكلة الثانية — تدوير تذكرة Hovod أثناء انتقال الفيديو
كان `releaseEvpTransitionCover()` يطلب تطابق عنوان `src` حرفيًا مع العنوان المسجل عند بدء الانتقال. لكن V231 يستطيع تدوير تذكرة Hovod وإسناد Manifest URL جديد للمورد نفسه. التطابق الحرفي قد يمنع غطاء الانتقال من التحرر رغم أن `playbackId` لم يتغير.

### الإصلاح
- أصبح فحص المورد في بوابة الغطاء يستخدم `EgyBookVideoResourceIdentityV237.sameResource()`.
- يجري التحقق من كل من عنوان `src` المعيّن و`currentSrc` الفعلي.
- تظل الروابط المختلفة فعليًا مختلفة؛ لا يُقبل تدوير التذكرة إلا عندما تؤكد وحدة V231 أن هوية تشغيل Hovod واحدة.
- لم تتغير آلية إصدار التذاكر أو Worker أو إعدادات Hovod.

## 4) استكمال أصول Service Worker
أظهر تدقيق مراجع `index.html` أن `evp-interaction-fix.js` كان مرتبطًا في الصفحة لكنه غير مدرج في `CORE_ASSETS`. تمت إضافته إلى أصول التطبيق الأساسية. كما أُدرجت وحدة V237 الجديدة، ورُقّمت نسخة الكاش إلى V237، وتغير إصدار رابط `script.js` حتى يحصل العميل على نسخة التعديل.

## 5) الملفات المعدلة
1. `index.html` — ربط وحدة هوية المورد قبل `script.js` وتحديث إصدار رابط `script.js`.
2. `script.js` — رفض استعادة Reels على post/resource مختلف، إلغاء سياق Reels المعلّق عند استبدال المشغل بسياق غير Reels، وربط تحرير غطاء الانتقال بهوية المورد.
3. `service-worker.js` — إصدار V237، إدراج وحدة هوية المورد، وإضافة `evp-interaction-fix.js` الذي كان مفقودًا من `CORE_ASSETS`.
4. `tests/bottom-nav-hitbox-guard-v236.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
5. `tests/live-preview-handoff-v234.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
6. `tests/navigation-restore-v2302.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
7. `tests/reels-return-recovery-v232.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
8. `tests/reels-session-recovery-v2301.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
9. `tests/reels-social-rail-persistence-v235.test.cjs` — تحديث توقع إصدار Service Worker الحالي.
10. `tests/video-transition-guard-v233.test.cjs` — تحديث توقع إصدار Service Worker الحالي ورابط `script.js`.
11. `tests/video-url-renewal-v231.test.cjs` — تحديث توقع إصدار Service Worker الحالي.

## 6) الملفات الجديدة
1. `egybook-video-resource-identity.js` — وحدة مستقلة لمطابقة هوية المورد وجلسة Reels.
2. `tests/video-resource-identity-v237.test.cjs` — اختبارات تدوير التذكرة، اختلاف المنشور/المورد، وربط الملفات وService Worker.
3. `README_EGYBOOK_V237_VIDEO_RESOURCE_IDENTITY_AR.md` — ملف تسليم المرحلة.

## 7) الملفات المحذوفة
- لا يوجد.

## 8) حدود التغيير والأنظمة المحمية
لم يتم تغيير:
- عنصر المشغل الموحد نفسه أو HTML الخاص به.
- `video-player.js` و`video-player.css`.
- `swipe-navigation.js` أو `swipe-navigation.css`؛ لم تتم إضافة نظام سحب رأسي آخر.
- آلية Keep-Alive الأساسية أو تخزين موضع Home/Profile.
- الهيدر العلوي أو السفلي، أبعادهما أو موضعهما أو حركتهما.
- Moments أو عدادات المشاهدات أو منطق نسب المشاهدة.
- Supabase أو RLS أو Supabase Storage أو Neon أو Cloudflare R2 أو Workers أو Edge Functions.
- Hovod backend أو إصدار/تجديد التذاكر من الخادم.

لا توجد أوامر SQL أو إعدادات نشر لخدمة خارجية ضمن هذا الإصدار.

## 9) الاختبارات
- مجموعات اختبارات Node.js: **12/12 PASS**.
- تأكيدات الاختبارات المعلنة: **208 PASS** (185 من مجموعة V236 السابقة + 23 تأكيدًا في اختبار V237 الجديد).
- `node --check`: **91/91** ملف JavaScript/CommonJS.
- مراجع HTML المحلية: **74 موجودة / 0 مفقود**.
- مراجع HTML المحلية غير المدرجة في `CORE_ASSETS`: **0**.
- أصول `CORE_ASSETS`: **79**.
- لا توجد ملفات محذوفة مقارنة بـV236.

## 10) حدود الاختبار
- محاولة Chromium Headless لتشغيل اختبار المتصفح الموجود انتهت بمهلة تشغيل؛ لذلك لم تُسجل كاختبار متصفح ناجح.
- لم يتم اختبار V237 على Android فعلي أو Android WebView أو iPhone/Safari أو Windows.
- لم يتم نشر V237 على GitHub Pages من بيئة البناء.
- اختبارات Node تتحقق من منطق الوحدة والربط البنيوي؛ ولا تثبت وحدها سلوك تشغيل الوسائط الفعلي في كل متصفح.

## 11) النشر
ارفع محتويات `egybook_work` إلى جذر `/Egybook/` مع الحفاظ على المسارات. لا يوجد SQL أو Worker deploy أو تعديل لإعدادات الخدمات. بعد النشر، افتح التطبيق عبر الإنترنت حتى يلتقط Service Worker إصدار V237 الجديد.

## 12) Commit
`Guard video session identity`
