# EgyBook V230.1 — Reels Session & Navigation Recovery

## النسخة الأساسية
تم البناء مباشرة على `EgyBook_V230_Background_Resume_Recovery.zip` المرفوع في المحادثة. لم يتم الرجوع إلى V229.2 أو أي إصدار أقدم.

## سبب الإصدار
أظهر اختبار المستخدم بعد فترة من الاستخدام والتنقل المتكرر عرض مشغل Reels كمساحة سوداء مع عناصر تحكم دون صورة فيديو أو مدة، وأحيانًا لا يستجيب الضغط المتكرر على تبويب Reels.

أثناء مراجعة V230 ومسار Reels وموصل المشغل الموحد ظهر مسار فشل محدد:
- `resumeFromNavigation()` كان يعيد نجاحًا بمجرد فتح سطح المشغل وإدخال طلب انتظار metadata، حتى لو لم يصل المصدر إلى metadata أو أصدر عنصر الفيديو حدث `error`.
- عند انتهاء مهلة الانتظار، كانت تُزال حالة الانتظار فقط، بينما يظل المشغل مفتوحًا/معلقًا وتظل جلسة التنقل محفوظة.
- `mount()` كان يعتبر أي Modal مفتوح يحمل `evp-reels-context` جلسة صالحة، دون فحص مصدر الفيديو أو `MediaError`؛ لذلك لا يصل إلى مصدر Reels لإعادة فتح الفيديو، ويبدو التبويب كأنه لا يستجيب.

## الإصلاحات
1. إضافة `egybook-reels-session-health.js` لتصنيف حالة عنصر الفيديو القانوني الحالي فقط: `ready` أو `loading` أو `failed` أو `missing-source`. الوحدة لا تغير المصدر ولا تستدعي `load()` ولا تنشئ مشغلًا.
2. جعل استعادة التنقل تستجيب لحدث `error`، وتتعامل مع `NETWORK_NO_SOURCE` أو غياب المصدر، وتحدد مهلة 10 ثوانٍ لانتظار metadata.
3. عند فشل الاستعادة، يتم إخفاء سطح المشغل الفارغ بدل تركه كطبقة سوداء مفتوحة، مع الاحتفاظ بمعرّف المنشور واللقطة اللازمة لمحاولة استعادة واحدة عبر عنصر الفيديو canonical نفسه.
4. إضافة `recoverFromNavigation(post)` في `EgyBookUnifiedVideoPlayer`. يعيد فتح نفس المنشور في عنصر المشغل الحالي، ويستعيد وقت التشغيل وحالة التشغيل/الكتم/الصوت/السرعة.
5. جعل `mount()` لا يتجاوز تحميل Reels إلا إذا كان المشغل المحتفظ به سليمًا أو ما زال في تحميل فعلي بمصدر صالح.
6. عند إعادة فتح المكتبة، يُفضّل المنشور الذي كان مفتوحًا قبل فشل الاستعادة بدل القفز تلقائيًا إلى أول Reel.
7. إضافة مهلة 12 ثانية لطلب كتالوج Reels عبر Worker حتى لا يظل طلب جلب المصدر معلقًا بلا نهاية. الطلب GET فقط، ولا يغيّر البيانات أو التخزين.

## الملفات المستبدلة
- `egybook_work/script.js`
- `egybook_work/egybook-reels-experience.js`
- `egybook_work/index.html`
- `egybook_work/service-worker.js`

## الملفات الجديدة
- `egybook_work/egybook-reels-session-health.js`
- `egybook_work/tests/reels-session-recovery-v2301.test.cjs`
- `egybook_work/README_EGYBOOK_V230_1_REELS_SESSION_RECOVERY_AR.md`
- تقرير مقارنة الملفات في جذر ZIP.
- تقرير الاختبارات في جذر ZIP.

## الملفات المحذوفة
لا يوجد.

## ما لم يتغير
- `video-player.js` و`video-player.css` ومشغل الفيديو canonical نفسه.
- نظام السحب الرأسي `swipe-navigation.js` وCSS الخاص به.
- `egybook-reels-experience.css` والتصميم البصري لـReels.
- `egybook-background-resume.js`؛ استعادة الخلفية من V230 ما زالت موجودة.
- `egybook-navigation-state.js` ومشاركة فيديو Home/Profile.
- Moments والتعليقات والتفاعلات والرسائل والإشعارات.
- Supabase وRLS وNeon وCloudflare R2 وWorkers وHovod وSupabase Storage.
- الهيدر العلوي والسفلي وإصلاح V229.2.
- المشاهدات ونسبة المشاهدة.

## الاختبارات
- اختبار وحدة تصنيف صحة مشغل Reels + تكامل نقاط الربط: 12/12 PASS.
- اختبارات V230 Background & Resume: 4/4 PASS.
- اختبارات V229.1 Navigation State: 7/7 PASS.
- اختبارات V229.2 Scroll Header: 4/4 PASS.
- فحص صياغة JavaScript لجميع ملفات المشروع.
- فحص HTML ومراجع الملفات وService Worker.
- التحقق من عدم تغير الملفات المحمية المذكورة أعلاه عبر SHA-256.

هذه اختبارات محلية ومحاكاة. لم يتم تشغيل الموقع المنشور بحساب حقيقي، ولم يتم اختبار Android Chrome/WebView أو iPhone Safari فعليًا.

## ما بقي لـ V231
لم تتم إضافة آلية تجديد URL موقّع/منتهي أو تغيير مسار Hovod. عند فشل رابط وسائط منتهي الصلاحية، قد تفشل إعادة المحاولة بنفس الرابط؛ تجديد المصدر والتحقق من التفويض يظلان ضمن V231.

## النشر
انشر محتويات `egybook_work` إلى جذر `/Egybook/` مع الحفاظ على المسارات. لا يوجد SQL جديد ولا Worker deployment ولا تغيير إعدادات خارجية.

## Commit
`Recover stuck Reels player sessions`
