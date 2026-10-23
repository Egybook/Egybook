-- EgyBook friend requests: additive migration
begin;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_no_self check (sender_id <> receiver_id),
  constraint friend_requests_sender_receiver_unique unique (sender_id, receiver_id)
);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests(receiver_id,status);
create index if not exists friend_requests_sender_status_idx on public.friend_requests(sender_id,status);
alter table public.friend_requests enable row level security;
grant select, insert, update, delete on public.friend_requests to authenticated;
drop policy if exists "Users read their friend requests" on public.friend_requests;
create policy "Users read their friend requests" on public.friend_requests for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);
drop policy if exists "Users send their own friend requests" on public.friend_requests;
create policy "Users send their own friend requests" on public.friend_requests for insert to authenticated
with check (auth.uid() = sender_id and status = 'pending');
drop policy if exists "Recipients respond to friend requests" on public.friend_requests;
create policy "Recipients respond to friend requests" on public.friend_requests for update to authenticated
using (auth.uid() = receiver_id or auth.uid() = sender_id)
with check (
  (auth.uid() = receiver_id and status in ('accepted','rejected')) or
  (auth.uid() = sender_id and status = 'cancelled')
);
drop policy if exists "Participants delete friend requests" on public.friend_requests;
create policy "Participants delete friend requests" on public.friend_requests for delete to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

notify pgrst, 'reload schema';
commit;
