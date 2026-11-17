# EgyBook Hovod Authorization V1.4

## مسار الملف
`supabase/functions/egybook-hovod-authorize/index.ts`

## التغيير في هذه الحزمة
- تحديث دالة التفويض لتتحقق من أن `audience_list_id` تخص نفس صاحب المنشور قبل فحص أعضاء القائمة.
- الإبقاء على عقد الاتصال الحالي مع Cloudflare Worker: يستقبل `playbackId` و`userId` و`action`، ويرجع `allowed` و`postId`.
- لا تنشئ الدالة Hovod ticket؛ الـWorker هو المسؤول عن إصدار التذكرة وتوقيعها بعد التحقق من جلسة المستخدم.

## توضيح أمني مهم
في مسار إصدار التذكرة، Worker يتحقق من Bearer token عبر Supabase Auth (`/auth/v1/user`) ويستخرج `user.id` بنفسه، ولا يعتمد على userId يرسله المتصفح مباشرة. ثم يستدعي هذه الدالة من الخادم إلى الخادم باستخدام `EGYBOOK_PLAYBACK_AUTH_SECRET`.
في مسار التجديد، Worker يتحقق من توقيع التذكرة الحالية ويطابق هوية المستخدم داخلها قبل إعادة فحص صلاحية المنشور.
لذلك لا ينبغي استدعاء هذه الدالة مباشرة من المتصفح أو كشف السر فيه.

## متطلبات التشغيل
- يجب أن تكون Migration الخاصة بجدول `hovod_playback_assets` قد نُفذت.
- يجب أن تتوفر أسرار Edge Function: `EGYBOOK_PLAYBACK_AUTH_SECRET` و`SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY`.
- يجب أن تتطابق قيمة `EGYBOOK_PLAYBACK_AUTH_SECRET` في Supabase مع القيمة الموجودة كـSecret في Worker.
- لم يتم نشر هذه الحزمة إلى Supabase ولم يتم اختبار اتصال الإنتاج بها.

## Commit المقترح
`Validate Hovod custom audience ownership`
