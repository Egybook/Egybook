# EgyBook — إعادة بناء تعليقات الريلز وتفاعلاتها (مرحلة الخادم)

## ما أُضيف في هذه النسخة
- Migration إضافية لـ Neon تضيف `parent_comment_id` و`edited_at` إلى `reel_comments` دون حذف السجلات الحالية.
- جدول `reel_comment_reactions` بتفاعل واحد لكل مستخدم على التعليق/الرد، مع السماح بتغيير التفاعل.
- جدول `reel_comment_notifications` لتسجيل إشعارات الرد والتفاعل داخل Neon.
- مسارات Worker لقراءة التعليقات بصفحات وترتيب `recent` أو `relevant`، وإضافة تعليق أو رد متداخل، وتعديل تعليق صاحبه، وحذفه لصاحبه أو لصاحب الريل، وإضافة/إزالة تفاعل.
- حماية المسارات الخاصة بجلسة Supabase والتحقق من هوية المستخدم من خلال `/auth/v1/user`.
- فهارس للتحميل حسب الريل، والردود، والمستخدم، والتفاعلات، والإشعارات.

## ملف الترحيل
`EGYBOOK_REELS_COMMENTS_REACTIONS_MIGRATION.sql`

يُنفذ مرة واحدة على قاعدة Neon الخاصة بالمشروع بعد أخذ نسخة احتياطية. الترحيل إضافي ولا يحذف `reels` أو `reel_comments` أو `reel_likes`.

## المسارات
- `GET /reels/:id/comments?limit=30&offset=0&sort=recent|relevant`
- `POST /reels/:id/comments` مع `{ "comment_text": "...", "parent_comment_id": 123 }`، واحذف `parent_comment_id` للتعليق الأصلي.
- `PATCH /reels/:id/comments/:commentId` مع `{ "comment_text": "..." }`
- `DELETE /reels/:id/comments/:commentId`
- `POST /reels/:id/comments/:commentId/reactions` مع `{ "reaction": "❤️" }`
- `DELETE /reels/:id/comments/:commentId/reactions`
- `GET /reels/:id/comment-notifications?limit=30`

جميع عمليات الكتابة تتطلب `Authorization: Bearer <Supabase access token>`. يمكن تمرير الجلسة أيضًا مع طلب GET للحصول على `my_reactions`؛ قراءة التعليقات نفسها عامة.

## حدود المرحلة الحالية
هذه مرحلة Backend/Neon وWorker فقط. فحص النسخة لم يُظهر أي مستهلك أمامي يستدعي مسارات `/reels/:id/comments` أو `/reels/:id/comments/:commentId/reactions`؛ لذلك لم أغيّر واجهة الريلز بشكل تخميني ولم أعتبر الأزرار موصولة بعد. يلزم في المرحلة التالية ربط واجهة التعليقات الحالية بهذه المسارات، وإثراء أسماء وصور أصحاب التعليقات من Supabase، وإظهار/إخفاء الردود والإشعارات والتحديث الفوري، ثم اختبارها على بيئة منشورة.

لم يتم نشر Worker أو تنفيذ migration على قاعدة Neon الحية من هذه البيئة.
