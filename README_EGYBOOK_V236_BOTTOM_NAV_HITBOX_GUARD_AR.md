# EgyBook V236 — Bottom Navigation Hitbox Guard

## 1) بيانات الإصدار
- الإصدار: **V236 — Bottom Navigation Hitbox Guard**.
- الإصدار الأساسي: **V235 — Reels Social Rail Persistence**.
- نطاق الإصلاح: منع وصول اللمسات الواقعة داخل المساحة المرئية للهيدر السفلي إلى المحتوى الموجود تحته على أجهزة اللمس.
- لا يتضمن الإصدار إعادة تصميم للهيدر أو تغيير موضعه أو ارتفاعه أو عرضه أو حركة إخفائه وإظهاره.

## 2) التشخيص من ملفات V235 والتسجيلين 218267.mp4 و218268.mp4
تمت مراجعة ملف التسليم V235، وبنية `index.html` و`styles.css` و`script.js` وملفات المشغل والريلز وService Worker، ثم فحص التسجيلين واللقطات المكبرة لمنطقة الشاشة السفلية.

ظهر في نهاية `styles.css` قانون قديم ضمن V198.6 مخصص لأجهزة اللمس:

```css
body:not(.egybook-albums-open) .bottom-navigation {
  pointer-events: none !important;
}
body:not(.egybook-albums-open) .bottom-navigation > .bottom-item,
body:not(.egybook-albums-open) .bottom-navigation > .bottom-item * {
  pointer-events: auto !important;
}
```

هذا القانون يجعل مساحة الهيدر السفلي نفسها غير مستقبلة للمس، بينما تبقى الأزرار فقط مستقبلة له. لذلك فإن المساحة الفارغة داخل خلفية الهيدر — خصوصًا الحافة السفلية والحشو أسفل الأزرار — تمرر اللمسة إلى العنصر الموجود خلفها. وهذا يطابق الأعراض التي وصفها المستخدم: فتح عناصر في صفحة الإشعارات أو وصول اللمسة إلى الفيديو في Reels وتشغيله/إيقافه.

## 3) الإصلاح المنفذ
أضيف ملف مستقل `egybook-bottom-nav-hitbox-guard.css`، ويعمل فقط على أجهزة اللمس ذات المؤشر الدقيق المنخفض، ويعيد استقبال اللمس إلى مساحة `.bottom-navigation` المرئية نفسها.

حدود الحماية:
- يستثني الحالات التي يكون فيها قسم المحادثة مفتوحًا أو مسار المنشور أو واجهة الألبومات، حتى لا يتدخل في حالات الإخفاء/العرض الخاصة بها.
- يستثني الهيدر الذي وصل بالفعل إلى حالة الإخفاء الكاملة (`scroll-chrome-hidden`) أو حالة الإخفاء القديمة (`nav-scroll-hidden`). عند إخفاء الهيدر تظل اللمسات تصل إلى المحتوى كما كان مقصودًا.
- الأزرار الحالية تظل هي وحدها التي تنفذ أوامر التنقل؛ المساحات الفارغة داخل مساحة الهيدر تمتص اللمسة ولا تفتح صفحة أو عنصرًا خلفها.
- لا توجد مستمعات أحداث جديدة ولا إيقاف propagation عام ولا طبقة شفافة.

## 4) شرط الهيدر — ما لم يتغير
لم يتم تعديل:
- HTML الداخلي للهيدر العلوي أو السفلي.
- `styles.css` أو قواعد موضع الهيدر أو عرضه أو ارتفاعه أو padding أو شكله أو خلفيته.
- `script.js` أو محرك Scroll Chrome الذي يحرك الهيدر العلوي والسفلي.
- `transform` أو `translate` أو `position` أو `bottom` أو `transition` أو مقدار/توقيت حركة الهيدرين.
- ترتيب الأزرار أو أيقوناتها أو وظائفها.

التغيير الوحيد المتعلق بالهيدر هو استقبال اللمس في الفراغ الداخلي للهيدر السفلي عندما يكون ظاهرًا. الهيدر العلوي لم يتم استهدافه مطلقًا.

## 5) الملفات المستبدلة/المعدلة
1. `index.html` — ربط ملف الحماية المستقل بعد ملفات CSS الحالية.
2. `service-worker.js` — ترقية نسخة الكاش إلى V236 وإضافة ملف CSS الجديد إلى `CORE_ASSETS`.
3. `tests/reels-return-recovery-v232.test.cjs` — تحديث توقع نسخة Service Worker فقط.
4. `tests/video-url-renewal-v231.test.cjs` — تحديث توقع نسخة Service Worker فقط.
5. `tests/live-preview-handoff-v234.test.cjs` — تحديث توقع نسخة Service Worker فقط.
6. `tests/navigation-restore-v2302.test.cjs` — تحديث توقع نسخة Service Worker فقط.
7. `tests/video-transition-guard-v233.test.cjs` — تحديث توقع نسخة Service Worker فقط.
8. `tests/reels-session-recovery-v2301.test.cjs` — تحديث توقع نسخة Service Worker فقط.
9. `tests/reels-social-rail-persistence-v235.test.cjs` — تحديث توقع نسخة Service Worker فقط؛ اختبار V235 نفسه ما زال يتحقق من ملفي Rail Guard وإصدارهما كما هما.

## 6) الملفات الجديدة
1. `egybook-bottom-nav-hitbox-guard.css` — إصلاح hitbox مستقل.
2. `tests/bottom-nav-hitbox-guard-v236.test.cjs` — اختبار نطاق القاعدة الجديدة وعدم مساسها بحركة الهيدر.
3. `README_EGYBOOK_V236_BOTTOM_NAV_HITBOX_GUARD_AR.md` — ملف التسليم.

## 7) الملفات المحذوفة
- لا يوجد.

## 8) الأنظمة التي لم يتم الاقتراب منها
- الهيدر العلوي وحركته.
- آلية حركة الهيدر السفلي وموقعه وشكله وأبعاده.
- `script.js` و`styles.css`.
- مشغل الفيديو الموحد و`video-player.js/css`.
- Reels Experience ونظام السحب الرأسي و`swipe-navigation.js/css`.
- Moments.
- إشعارات Supabase/Neon الموحدة والرسائل والمصادقة والجلسات.
- Persistent Navigation State وKeep-Alive Video Player.
- المشاهدات ونسبة المشاهدة.
- Supabase وRLS وSupabase Storage وNeon وCloudflare R2 وWorkers وHovod.

## 9) الاختبارات المنفذة
- مجموعات Node.js: **11/11 ناجحة**.
- تأكيدات الاختبارات المعلنة: **185 PASS**، منها 15 تأكيدًا جديدًا لاختبار V236.
- `node --check`: **89/89 ملف JavaScript وCommonJS ناجح**.
- تمت مراجعة ربط الملف الجديد في HTML وService Worker.
- أُجريت مقارنة SHA-256 بين V235 وV236 لحصر الملفات المتغيرة والجديدة والمحذوفة.

## 10) حدود الاختبار
- لم يكتمل اختبار Chromium Headless في بيئة البناء؛ انتهت المحاولة دون نتيجة قابلة للاعتماد، لذلك لا أسجل اختبار متصفح ناجحًا.
- لم يتم الاختبار على جهاز Android فعلي أو Android WebView أو iPhone/Safari أو Windows.
- يحتاج سلوك Folax إلى تأكيد على الجهاز بعد النشر: إذا كان الاستدعاء يحدث من منطقة إيماءات نظام Android الواقعة خارج مساحة صفحة الويب، فلا يستطيع CSS/JavaScript داخل الموقع منع إيماءة نظام التشغيل. الإصلاح الحالي يمنع click-through داخل مستطيل الهيدر السفلي الفعلي في الموقع فقط.

## 11) النشر
ارفع محتويات `egybook_work` إلى جذر `/Egybook/` مع الحفاظ على مسارات الملفات. لا يوجد SQL أو Worker deploy أو تغيير إعدادات لخدمات خارجية. يُنصح بإعادة فتح الموقع/تحديث Service Worker بعد النشر حتى يتم تحميل نسخة V236.

## 12) Commit
`Fix bottom navigation tap hitbox`
