# تكامل EgyBook مع Hovod — إصلاح عقد التفويض v1.2

## ما الذي تم تصحيحه

كان Worker يرسل عقدًا (`allowed/postId`) لا تطبقه دالة Supabase الموجودة في مشروع EgyBook؛ كما كان ينشئ تذكرة HMAC محليًا بدل استخدام التذكرة التي تصدرها الدالة الموثوقة. تم تصحيح المسار ليطابق عقد Hovod وSupabase الحالي: 

1. طلب التذكرة الأولية: المتصفح يرسل جلسة Supabase إلى Worker؛ Worker يتحقق من المستخدم ثم يمرر `Authorization: Bearer ...` إلى Edge Function.
2. Edge Function تتحقق من المستخدم، وتراجع `hovod_playback_assets` والمنشور والجمهور، ثم تصدر التذكرة بتوقيع `PLAYBACK_TOKEN_SECRET`.
3. Hovod يتحقق من التذكرة باستخدام `PLAYBACK_TOKEN_SECRET` نفسه.
4. عند التجديد، Hovod يرسل `playbackId`, `userId`, `currentTicket`, `currentTicketId` إلى مسار Worker `/hovod/playback/refresh`. Worker يتحقق من السر المشترك ويمرر الطلب إلى Edge Function بهيدر `x-hovod-refresh-secret`. الدالة تتحقق من التذكرة الحالية وتعيد فحص صلاحية المشاهدة قبل إصدار بديل.
5. Worker لا ينشئ تذاكر بنفسه؛ قرار الصلاحية وإصدار التذاكر مركزيان في Edge Function.

## إعدادات Cloudflare Worker

- `SUPABASE_URL` و`SUPABASE_ANON_KEY`: للتحقق من جلسة المستخدم.
- `EGYBOOK_PLAYBACK_AUTH_URL`: رابط دالة Supabase `https://<PROJECT_REF>.supabase.co/functions/v1/egybook-hovod-authorize`.
- `EGYBOOK_HOVOD_REFRESH_SECRET`: سر عشوائي منفصل بطول 32 حرفًا على الأقل؛ يطابق `EGYBOOK_PLAYBACK_AUTH_SECRET` في Supabase و`EGYBOOK_PLAYBACK_REFRESH_SECRET` في Hovod.

لا يحتاج Worker إلى `HOVOD_PLAYBACK_TOKEN_SECRET` بعد هذا التصحيح؛ دالة Supabase وحدها تصدر التذاكر باستخدام `PLAYBACK_TOKEN_SECRET`.

## إعدادات Supabase Edge Function

- `SUPABASE_URL` و`SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` — سر خادمي داخل Supabase فقط، لا يوضع في Worker أو الواجهة.
- `PLAYBACK_TOKEN_SECRET` — سر HMAC بطول 32 حرفًا على الأقل، يطابق Hovod حرفيًا.
- `EGYBOOK_PLAYBACK_AUTH_SECRET` — يطابق `EGYBOOK_HOVOD_REFRESH_SECRET` في Worker و`EGYBOOK_PLAYBACK_REFRESH_SECRET` في Hovod.

## إعدادات Hovod

- `PLAYBACK_SECURITY_MODE=private`
- `PLAYBACK_TOKEN_SECRET` = نفس قيمة `PLAYBACK_TOKEN_SECRET` في Supabase.
- `EGYBOOK_PLAYBACK_REFRESH_URL=https://<WORKER_HOST>/hovod/playback/refresh`
- `EGYBOOK_PLAYBACK_REFRESH_SECRET` = نفس قيمة سر التجديد في Worker وSupabase.
- `S3_PUBLIC_BASE_URL` يجب أن يكون رابطًا صحيحًا لعنوان تقديم ملفات HLS/الصور من R2. إبقاء R2 خاصًا يتطلب إعداد طبقة تقديم آمنة متوافقة مع طريقة تشغيل Hovod؛ لا تجعل Bucket عامًا لمجرد تجاوز خطأ تشغيل.

## متطلبات قاعدة البيانات

يجب تطبيق migration `202611170001_egybook_hovod_playback_assets.sql` مرة واحدة فقط، بعد التحقق من عدم وجود الجدول بالفعل. يجب أن يضيف مسار الرفع/الإكمال الموثوق سجلًا في `public.hovod_playback_assets` ويربط `playback_id` بـ`post_id` و`owner_id`، ثم يحول `processing_status` إلى `ready` بعد نجاح المعالجة. لا تمنح المتصفح صلاحية الكتابة لهذا الجدول.

الدالة تعتمد أيضًا على الجداول والأعمدة التالية: `posts`, `custom_audience_lists`, `custom_audience_list_members`, `close_friends`, `friend_requests`, `user_follows`. يجب مطابقتها مع مخطط المشروع قبل النشر.

## حدود ما تم إثباته

- تمت مراجعة توافق عقد الطلب/الاستجابة برمجيًا بين Worker وEdge Function وHovod v1.4.4.
- اجتاز `worker.js` فحص صياغة Node.js.
- لم يتم نشر Worker أو Edge Function، ولم يتم تطبيق migration أو اختبار R2/Hovod حيًا من هذه الحزمة.
- لا تعتبر تكامل Hovod جاهزًا للإنتاج حتى تطبيق الإعدادات في بيئة اختبار، وإنشاء asset من مسار الرفع، ثم اختبار إصدار/تجديد/رفض التذكرة.
