# سجل تحديث EgyBook – Reels Comments V2

## ملفات مستبدلة
- `index.html` — تحميل ملفات وحدة تعليقات الريلز الجديدة.
- `script.js` — توجيه فتح التعليقات في سياق الريلز إلى الوحدة المستقلة، مع ترك مسار المنشورات العادية كما هو.
- `cloudflare/egybook-reels-api/worker.js` — إضافة مسار الربط بين منشور Supabase وسجل Neon.

## ملفات جديدة
- `reels-comments.js`
- `reels-comments.css`
- `NEON_SQL.sql`
- `README_REELS_COMMENTS_V2_AR.md`
- `CHANGELOG_REELS_COMMENTS_V2_AR.md`

## ملفات محذوفة
- لا توجد.

## SQL
- Neon فقط: `NEON_SQL.sql`.
- Supabase: لا توجد تغييرات SQL في هذا التحديث.

## Commit
`Add modular Reels comments bridge`

## الاختبارات
- `node --check script.js` — ناجح.
- `node --check reels-comments.js` — ناجح.
- `node --check cloudflare/egybook-reels-api/worker.js` — ناجح.
- لم يتم نشر Worker أو تشغيل SQL على قاعدة حية أو تنفيذ اختبار تكامل فعلي.
