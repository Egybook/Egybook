-- EgyBook: allow signed-in users to read accepted friendship rows so profile
-- owners' friend lists can be assembled correctly. Pending/private requests
-- remain visible only to their sender and receiver.
begin;

alter table public.friend_requests enable row level security;

drop policy if exists "Users read their friend requests" on public.friend_requests;
drop policy if exists "Participants and accepted friends can read relationships" on public.friend_requests;
create policy "Participants and accepted friends can read relationships"
on public.friend_requests
for select
to authenticated
using (
  status = 'accepted'
  or auth.uid() = sender_id
  or auth.uid() = receiver_id
);

notify pgrst, 'reload schema';
commit;
