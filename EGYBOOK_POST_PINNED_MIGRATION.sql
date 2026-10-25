-- EgyBook: persistent pinned-post support
alter table public.posts add column if not exists pinned_at timestamptz;
create index if not exists posts_pinned_at_idx on public.posts (user_id, pinned_at desc) where pinned_at is not null;
