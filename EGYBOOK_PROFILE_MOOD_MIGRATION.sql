-- EgyBook profile mood status migration
-- Run once in Supabase SQL Editor. Empty mood means no badge is displayed.
alter table public.profiles add column if not exists mood text not null default '';

alter table public.profiles drop constraint if exists profiles_mood_allowed;
alter table public.profiles add constraint profiles_mood_allowed check (mood in (
  '', '😊 مبسوط', '😌 رايق', '💪 متحمس', '🥰 في مود الحب',
  '😎 واثق من نفسي', '🤔 بفكر', '😴 نعسان', '☕ محتاج قهوة',
  '🔥 في قمة النشاط', '🎯 مركز على أهدافي', '😔 مش أحسن حاجة',
  '😢 حزين شوية', '😤 مضغوط', '🌴 محتاج إجازة'
));
