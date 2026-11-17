# EgyBook + Hovod Authorization v1.5

## ما الذي تغير في v1.5؟

تم تحديث Edge Function `supabase/functions/egybook-hovod-authorize/index.ts` لتدعم مسارين:

1. **إصدار التذكرة الأولية:** يستقبل طلب POST يحمل Supabase access token في `Authorization: Bearer ...`، ويتحقق من المستخدم عبر `auth.getUser()`؛ لا يعتمد على `userId` يرسله المتصفح.
2. **تجديد التذكرة من Hovod:** يستقبل الهيدر `x-hovod-refresh-secret` وجسم الطلب الذي يستخدمه Hovod (`playbackId`, `userId`, `currentTicket`, `currentTicketId`)، ويتحقق من التذكرة الحالية ثم يعيد فحص أهلية المشاهدة ويصدر تذكرة جديدة.

صيغة التذكرة متوافقة مع Hovod v1.3.1: `payload.signature` بتوقيع HMAC-SHA256، والحقول `aud`, `iss`, `pid`, `sub`, `jti`, `iat`, `exp`.

## متغيرات Edge Function المطلوبة

- `SUPABASE_URL` — يوفّرها Supabase عادةً.
- `SUPABASE_ANON_KEY` — يلزم لمسار التحقق من جلسة المستخدم.
- `SUPABASE_SERVICE_ROLE_KEY` — يلزم لقراءة ربط الفيديو والمنشور والجمهور من جهة الخادم.
- `PLAYBACK_TOKEN_SECRET` — سر HMAC بطول 32 حرفًا على الأقل؛ يجب أن يطابق `PLAYBACK_TOKEN_SECRET` في Hovod.
- `EGYBOOK_PLAYBACK_AUTH_SECRET` — يستخدمه الكود كسر مشترك للتحقق من طلبات تجديد Hovod؛ يجب أن يطابق `EGYBOOK_PLAYBACK_REFRESH_SECRET` في Hovod. لا يُرسل هذا السر من المتصفح.

## إعداد Hovod

- `PLAYBACK_SECURITY_MODE=private`
- `PLAYBACK_TOKEN_SECRET` = نفس قيمة Edge Function.
- `EGYBOOK_PLAYBACK_REFRESH_URL` = رابط Edge Function: `/functions/v1/egybook-hovod-authorize`.
- `EGYBOOK_PLAYBACK_REFRESH_SECRET` = نفس قيمة `EGYBOOK_PLAYBACK_AUTH_SECRET` في Supabase.

## متطلبات الربط والقيود

- جدول `public.hovod_playback_assets` يجب أن يحتوي ربطًا موثوقًا بين `playback_id` و`post_id` و`owner_id` وحالة `processing_status='ready'`. الـ migration المرفقة additive وتضيف هذا الجدول فقط.
- يجب أن ينشئ مسار الرفع/الإكمال الموثوق هذا الربط من جهة الخادم؛ لا تمنح المتصفح صلاحية الكتابة للجدول.
- الكود يعتمد على الجداول والأعمدة التالية كما هي مكتوبة: `posts`, `custom_audience_lists`, `custom_audience_list_members`, `close_friends`, `friend_requests`, `user_follows`. يجب مطابقة هذه الأسماء وقيم `visibility` مع مخطط الإنتاج قبل الاعتماد النهائي.
- هذا التحديث لا يفعّل دعم الزائر غير المسجل لإصدار التذكرة الأولية.
- لا تنشر إعدادات Hovod ولا تربطه بالموقع قبل ضبط الأسرار المتطابقة واختبار الإصدار والتجديد فعليًا.

## الأمان والنشر

- لا تضع `SERVICE_ROLE_KEY` أو أي سر في ملفات الواجهة أو المستودع العام.
- لا تشارك قيم الأسرار في المحادثة أو الصور.
- `Verify JWT` في إعدادات Supabase يمكن أن يظل معطلاً لأن الدالة تتحقق من JWT بنفسها عبر `auth.getUser()`؛ طلبات التجديد تتحقق من السر المشترك وتوقيع التذكرة.
- التحديث لا يحذف أو يعدّل ملفات الفيديو القديمة أو جداول المنشورات. لا تشغّل migration مرة أخرى إذا كانت قد طُبقت بالفعل؛ تحقق من وجود الجدول أولًا.

## حالة الاختبار

تم دمج ملف الدالة ومراجعة توافق صيغة HMAC وحقول التذكرة ومسار التجديد مع كود Hovod v1.3.1. لم يتم تنفيذ اختبار حي على مشروع Supabase أو خادم Hovod من هذه الحزمة؛ لذلك لا تعتبر النسخة اعتمادًا إنتاجيًا قبل الاختبار على بيئة منفصلة.
