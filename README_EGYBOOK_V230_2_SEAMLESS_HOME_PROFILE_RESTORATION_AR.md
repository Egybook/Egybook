# EgyBook V230.2 — Seamless Home & Profile Restoration

## النسخة الأساسية
تم البناء مباشرة على الملف المرفوع:
`EgyBook_V230_1_Reels_Session_Recovery.zip`

لم يتم الرجوع إلى إصدار أقدم أو إعادة بناء أي نظام.

## المشكلة التي عالجها الإصدار
عند مغادرة Home أو Profile والعودة إليهما، كان المتصفح يستطيع إظهار الصفحة عند موضع التمرير الحالي (غالبًا صفر) قبل أن تنفذ وحدة Persistent Navigation State أمر `window.scrollTo()` لاستعادة الموضع المحفوظ.

## السبب الجذري المؤكد من ترتيب الكود في V230.1
1. داخل `setPage()` في `script.js`، يتم إرسال `egybook:pagechange` قبل إظهار `.container`.
2. يوجد مستمع لهذا الحدث يستدعي `syncPrimaryNavigationActive(page)`، وهذه الدالة ترسل `egybook:primarypagechange` بينما Home ما زالت مخفية.
3. تستقبل وحدة `egybook-navigation-state.js` الحدث وتبدأ الاستعادة، لكنها تؤجل محاولة `scrollTo()` عبر إطارَي `requestAnimationFrame`.
4. يكمل `setPage()` في المهمة نفسها ويظهر `.container` قبل تنفيذ المحاولة المؤجلة؛ لذلك يمكن أن يرسم المتصفح Home عند الموضع الحالي (غالبًا صفر) قبل أن يصل callback الثاني إلى `window.scrollTo()`.
5. داخل `routeToProfile()` يصدر حدث Profile قبل إزالة `hidden` عن `#profilePage`، لكن محاولة الاستعادة مؤجلة أيضًا؛ لذلك يمكن أن يظهر Profile في فرصة الرسم بين إظهاره وتنفيذ `scrollTo()`.
6. إذا كان ارتفاع محتوى الصفحة أقل من الموضع المطلوب، تنتظر الوحدة زيادة الارتفاع (بمهلة محددة) والسطح قابل للرسم بالفعل. وهذا يفسر استمرار ظهور المحتوى الخاطئ أثناء تأخر تحميل المنشورات.

هذه المشكلة في ترتيب إظهار سطح الصفحة واستعادة موضع المستند، وليست دليلًا بحد ذاتها على فقدان قيمة موضع التمرير المحفوظة.

## الإصلاح المنفذ
- عند بدء استعادة موضع غير صفري لـ Home أو Profile، تضيف وحدة التنقل علامة مؤقتة إلى جذر الصفحة المستهدفة بشكل متزامن مع حدث تغيير الصفحة.
- ملف CSS مستقل `egybook-navigation-restore.css` يجعل الجذر وأبناءه غير قابلين للرسم أو استقبال النقر مؤقتًا.
- يستخدم CSS خاصية `visibility` وليس `display:none`، وبالتالي يحتفظ المحتوى بمساحته وارتفاعه داخل التخطيط، ويمكن قياس ارتفاع المستند أثناء انتظار استعادة المنشورات.
- تنفذ الوحدة `window.scrollTo()` بينما الصفحة ما زالت غير قابلة للرسم، ثم تزيل العلامة في المهمة نفسها بعد تطبيق الموضع؛ أول إطار مرئي للصفحة يبدأ عند الموضع المستعاد.
- إذا زاد ارتفاع المحتوى متأخرًا، تظل الصفحة غير مرئية حتى يصبح الموضع المطلوب قابلًا للوصول أو تنتهي مهلة الأمان الحالية. يظل الموضع الأصلي محفوظًا في sessionStorage ولا يستبدل بصفر.
- إذا تغير المسار أثناء الانتظار، تلغي الوحدة محاولة المسار القديم وتحرر علامة الإخفاء. ولا تحفظ الموضع المؤقت صفرًا فوق القيمة المحفوظة للمسار الذي لم تكتمل استعادته.
- لم تعد إيماءات التمرير العادية تلغي الاستعادة وتكشف الصفحة عند الصفر؛ إلغاء الاستعادة يحدث عند الانتقال الفعلي إلى مسار آخر.
- تم الإبقاء على الاسم القديم `window.__egybookNavigationStateV2291` كمرجع توافق للملفات الموجودة، مع إضافة الاسم `window.__egybookNavigationStateV2302` وإصدار API جديد.

## الملفات المستبدلة
- `egybook_work/egybook-navigation-state.js` — إضافة Paint Gate وضمان تحريره عند اكتمال الاستعادة أو إلغائها.
- `egybook_work/index.html` — ربط ملف CSS المستقل وتحديث إصدار ملف وحدة التنقل.
- `egybook_work/service-worker.js` — تحديث رقم نسخة الكاش وإضافة CSS الجديد إلى CORE_ASSETS وتحديث مرجع وحدة التنقل.
- `egybook_work/tests/reels-session-recovery-v2301.test.cjs` — تحديث تحقق إصدار Service Worker إلى V230.2؛ بقية اختبارات Reels لم تتغير وظيفيًا.
- `egybook_work/tests/v2291-browser-checks.html` — تحديث مرجع وحدة التنقل وإضافة ملف CSS الجديد لصفحة فحص التنقل القديمة.

## الملفات الجديدة
- `egybook_work/egybook-navigation-restore.css` — طبقة CSS مستقلة للتحكم في أول إطار مرئي لـ Home وProfile.
- `egybook_work/tests/navigation-restore-v2302.test.cjs` — اختبارات ترتيب الرسم، وتأخر نمو المحتوى، والتنقل السريع، وعدم استبدال الموضع المحفوظ بالصفر، وربط HTML وService Worker.
- `egybook_work/tests/navigation-restore-v2302-browser.html` — صفحة اختبار متصفح فعلية يمكن فتحها بعد النشر من `/Egybook/tests/navigation-restore-v2302-browser.html`.
- `egybook_work/README_EGYBOOK_V230_2_SEAMLESS_HOME_PROFILE_RESTORATION_AR.md` — هذا التقرير.

## الملفات المحذوفة
لا يوجد.

## ملفات وواجهات لم تتغير
- `script.js` و`styles.css` — لم يتم تحميل أي منطق جديد إليهما.
- `video-player.js` و`video-player.css` ومشغل الفيديو الموحد.
- `swipe-navigation.js` و`swipe-navigation.css`.
- `egybook-reels-experience.js` وCSS الخاص بـ Reels.
- `egybook-background-resume.js` و`egybook-reels-session-health.js`.
- `egybook-shared-feed-media.js`.
- Moments والتعليقات والتفاعلات والرسائل والإشعارات.
- حركة الهيدر العلوي والسفلي.
- Supabase وRLS وSupabase Storage وNeon وCloudflare R2 وWorkers وHovod.
- نظام المشاهدات ونسبة المشاهدة.

## الاختبارات المنفذة
- اختبارات V230.2 الجديدة: PASS 8/8.
- اختبارات Navigation State V229: PASS 7/7.
- اختبارات Reels Session Recovery V230.1: PASS 18/18.
- اختبارات Background & Resume V230: PASS 4/4.
- اختبارات Scroll Header V229.2: PASS 4/4.
- مجموع حالات الاختبار المحلية: PASS 41/41.
- `node --check` لجميع ملفات JavaScript: PASS 73/73.
- فحص مراجع الملفات المحلية في `index.html`: لا توجد مراجع محلية مفقودة.
- فحص مراجع CSS وJavaScript الجديدة داخل HTML وService Worker: PASS.
- فحص SHA-256 للملفات المحمية: لم تتغير.

## حدود الاختبار
- الاختبارات المنفذة محلية باستخدام Node.js ومحاكاة DOM/الأحداث؛ وليست اختبارًا للموقع المنشور أو لحساب حي.
- تمت إضافة صفحة اختبار Chromium داخل `tests/`، لكن لم يكتمل تشغيل Chromium Headless في بيئة البناء الحالية بسبب تعطل تشغيل عملية GPU/المتصفح وانتهاء مهلة التشغيل. لذلك لا أسجل اختبار متصفح فعلي على أنه ناجح.
- لم يتم اختبار Android Chrome أو Android WebView أو Safari/iPhone على جهاز فعلي.
- يلزم بعد النشر اختبار العودة إلى منشور بعيد في Home وProfile، والتأكد من عدم ظهور بداية الصفحة قبل استعادة الموضع.

## النشر
انشر محتويات `egybook_work` إلى جذر `/Egybook/` مع الحفاظ على بنية الملفات. لا يوجد SQL جديد، ولا حاجة لنشر Worker أو تعديل إعدادات Supabase/Neon/R2/Hovod.

## Commit
`Fix seamless home profile restoration`
