EgyBook Reels Worker + Hovod Playback Bridge v1.2

هذا المصدر خاص بالـ Worker المنشور باسم egybook-reels-api.
- MEDIA_BUCKET -> egybook-media
- REELS_BUCKET -> egybook-reels
- يتضمن مساري Hovod لإصدار وتجديد تذاكر التشغيل عبر Supabase Edge Function.

قبل النشر:
1) راجع HOVOD_EGYBOOK_BRIDGE_AR.md.
2) تأكد من نشر Supabase Function وتطبيق migration مرة واحدة بعد فحص الجدول.
3) اضبط المتغيرات/الأسرار من لوحة Cloudflare دون وضعها في الملفات.
4) اختبر في بيئة منفصلة قبل تحويل أي حركة إنتاجية.

لم يتم نشر أي تغيير تلقائيًا، ولم تُحذف أي بيانات.
