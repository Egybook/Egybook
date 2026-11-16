# خدمة تفويض تشغيل Hovod لـ EgyBook — الإصدار 1

هذه الحزمة تضيف خدمة خلفية مستقلة لتفويض تشغيل الفيديو. لا تغيّر ملفات الواجهة ولا Worker المنشور ولا تنقل الفيديوهات القديمة.

## الملفات
- `supabase/migrations/202611170001_egybook_hovod_playback_assets.sql`: جدول ربط خاص بالخادم بين `playback_id` والمنشور، مع حالة المعالجة.
- `supabase/functions/egybook-hovod-authorize/index.ts`: Supabase Edge Function تتحقق من الربط وحالة `ready` وجمهور المنشور.

## قواعد الجمهور التي تطبقها الخدمة
مطابقة لقواعد `EGYBOOK_POST_AUDIENCE_PRIVACY_V33.sql` الموجودة في نسخة V55:
- `الجميع` / `public` / `everyone` / `publico`: عام.
- `أنا فقط`: المالك فقط.
- `أشخاص محددون`: `audience_user_ids`.
- `قائمة مخصصة`: `custom_audience_list_members`.
- `الأصدقاء المقربون`: `close_friends`.
- `الأصدقاء`: علاقة `friend_requests` بحالة `accepted` في أي اتجاه.
- `عام` و`استثناء`: صديق مقبول أو متابع للمالك، مع تطبيق `excluded_user_ids` في حالة استثناء.
- أي قيمة غير معروفة تُرفض افتراضيًا.

## التثبيت بعد مراجعة المستخدم
1. تأكد أن migrations التالية مطبقة في Supabase: `EGYBOOK_FRIEND_REQUESTS_MIGRATION.sql` و`EGYBOOK_PROFILE_RELATIONSHIPS_MIGRATION.sql` و`EGYBOOK_POST_AUDIENCE_PRIVACY_V33.sql`؛ لأنها تنشئ جداول وعلاقات وقواعد الجمهور التي تعتمد عليها الخدمة.
2. شغّل ملف SQL الجديد في Supabase SQL Editor.
3. انشر Edge Function باسم `egybook-hovod-authorize` مع تعطيل تحقق JWT على مستوى بوابة Edge Function (`--no-verify-jwt`)؛ الدالة نفسها تتحقق من سر داخلي قوي ثابت الزمن قبل أي استعلام.
4. أضف Secret للخدمة باسم `EGYBOOK_PLAYBACK_AUTH_SECRET` (32 حرفًا عشوائيًا على الأقل).
5. في Cloudflare Worker اضبط `EGYBOOK_PLAYBACK_AUTH_URL` على رابط الدالة، و`EGYBOOK_PLAYBACK_AUTH_SECRET` بنفس القيمة.
6. أضف `SUPABASE_SERVICE_ROLE_KEY` إلى Secrets الخاصة بـSupabase Edge Function فقط؛ لا تضعه في Worker أو الواجهة.

## مهم قبل الاختبار الحقيقي
- جدول الربط فارغ حتى يقوم مسار رفع Hovod الموثوق بإضافة سجل بعد نجاح المعالجة.
- لا تملأ الجدول يدويًا بمعرّفات تجريبية ولا تجعل الواجهة تكتب فيه.
- يلزم أن يكتب مسار رفع Hovod: `playback_id`, `post_id`, `owner_id`, ثم يغيّر `processing_status` إلى `ready` بعد اكتمال HLS والتحقق من الملفات.
- هذه المرحلة لا تنشئ أصل Hovod ولا ترفع الفيديو إلى Hovod. لذلك لن تصدر تذاكر صالحة قبل اكتمال مسار الرفع.
- لم تُنفذ أي عملية نشر أو تعديل في مشروع Supabase/Cloudflare الحي.

## توافق ومخاطر
المنطق مستند إلى SQL migrations المرفقة في V55. يجب التأكد أن هذه migrations مطبقة فعلًا في مشروع Supabase الحي، وأن جدول `user_follows` بأعمدته `follower_id` و`following_id` موجود كما هو مستخدم في migration. إذا اختلف المخطط، فالخدمة تفشل مغلقة ولا تمنح الوصول.
