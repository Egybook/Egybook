# EgyBook + Hovod Authorization — Ticket Contract Fix

## ما الذي يصلحه هذا التحديث؟
- إصدار تذكرة HMAC-SHA256 متوافقة مع عقد Hovod V1.3.1.
- التذكرة تحمل `aud=hovod-playback` و`iss=egybook` و`pid` و`sub` و`jti` و`iat` و`exp`.
- مدة التذكرة 10 دقائق كحد أقصى.
- في `refresh` يتم التحقق من التذكرة الحالية وتطابق المستخدم ومعرّف التذكرة، ثم إعادة فحص صلاحية المنشور قبل إصدار تذكرة جديدة بمعرّف `jti` جديد.
- تُرفض الطلبات عند غياب الإعدادات أو فشل فحص الصلاحيات (fail closed).
- لا يتم تعديل نظام الفيديو القديم أو جداول المنشورات أو سياسات RLS الحالية.

## أسرار Supabase Edge Function المطلوبة
اضبطها في إعدادات Edge Function على الخادم فقط:
- `EGYBOOK_PLAYBACK_AUTH_SECRET`: سر عشوائي لا يقل عن 32 حرفًا، مشترك بين Hovod وخدمة التفويض.
- `PLAYBACK_TOKEN_SECRET`: سر عشوائي لا يقل عن 32 حرفًا، ويجب أن يطابق القيمة الموجودة في Hovod.

لا تضع أيًا منهما في HTML أو JavaScript أو GitHub Pages، ولا ترسلهما في المحادثة.

## عقد الطلب
`POST` مع ترويسة `x-egybook-playback-secret`.

إصدار أولي:
```json
{"action":"issue","playbackId":"...","userId":"..."}
```

تجديد:
```json
{"action":"refresh","playbackId":"...","userId":"...","currentTicket":"...","currentTicketId":"..."}
```

الاستجابة في الحالتين:
```json
{"ticket":"<payload>.<signature>","expiresAt":1234567890,"refreshAfterSec":540}
```

## ربط Hovod
- `EGYBOOK_PLAYBACK_REFRESH_URL` يجب أن يشير إلى رابط هذه Edge Function.
- `EGYBOOK_PLAYBACK_REFRESH_SECRET` في Hovod يجب أن يطابق `EGYBOOK_PLAYBACK_AUTH_SECRET` في Supabase.
- `PLAYBACK_TOKEN_SECRET` في Hovod يجب أن يطابق `PLAYBACK_TOKEN_SECRET` في Supabase.
- مسار Hovod refresh يرسل `userId` المستخرج من التذكرة الموقعة؛ لا يقبل هوية من المتصفح مباشرة.
- مسار الإصدار الأولي يجب أن يستدعيه Worker موثوق بعد التحقق من جلسة Supabase للمستخدم. لا تستدعِ Edge Function من المتصفح مباشرة ولا تثق في `userId` مرسل من العميل.

## ما لم يُعتمد بعد
هذه مراجعة/إصلاح لعقد التذكرة داخل Edge Function فقط. لا يعني ذلك أن التكامل أصبح جاهزًا للإنتاج. يلزم قبل النشر:
1. تعديل/تأكيد Hovod Worker لمسار الإصدار الأولي بحيث يتحقق من JWT Supabase بنفسه ثم يمرر user ID الموثق.
2. التحقق من جداول الحظر وتعطيل الحساب والإشراف، لأن مخططها لم يكن مثبتًا ضمن هذه الحزمة ولم نضف أسماء جداول مفترضة.
3. اختبار صلاحيات الجمهور مع قيم قاعدة البيانات الفعلية، ثم اختبار HLS وSafari وتجديد التذكرة أثناء التشغيل.
4. نشر migration الإضافية فقط بعد مراجعتها واعتمادها؛ لا تشغّلها تلقائيًا.

## حماية النظام الحالي
هذا التحديث لا يغير `posts` أو تخزين Supabase/R2 القديم ولا ينقل أو يحذف أي وسائط. جدول الربط `hovod_playback_assets` إضافي ومعزول، ويظل غير متاح لـ anon/authenticated.
