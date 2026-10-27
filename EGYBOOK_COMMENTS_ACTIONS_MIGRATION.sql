-- EgyBook: comment edit marker + secure mention notification inserts
begin;
alter table public.post_comments add column if not exists edited_at timestamptz;
grant insert on public.notifications to authenticated;
drop policy if exists "Users create notifications for mentioned users" on public.notifications;
create policy "Users create notifications for mentioned users" on public.notifications
for insert to authenticated
with check (
  auth.uid() = actor_id
  and type = 'comment'
  and recipient_id <> auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = recipient_id
      and lower(coalesce(p.username,'')) in (
        select lower(regexp_replace(token, '^@', ''))
        from regexp_split_to_table(coalesce(body,''), '[[:space:]]+') as token
        where token like '@%'
      )
  )
);
commit;
notify pgrst, 'reload schema';
