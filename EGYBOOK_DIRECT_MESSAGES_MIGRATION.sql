-- EgyBook direct messages: private one-to-one text messages
-- Run once in Supabase SQL Editor. No service-role key is needed in the browser.

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_no_self_message check (sender_id <> recipient_id)
);

create index if not exists direct_messages_sender_created_idx
  on public.direct_messages (sender_id, created_at desc);
create index if not exists direct_messages_recipient_created_idx
  on public.direct_messages (recipient_id, created_at desc);
create index if not exists direct_messages_conversation_created_idx
  on public.direct_messages (sender_id, recipient_id, created_at asc);

alter table public.direct_messages enable row level security;

 drop policy if exists "Participants can read direct messages" on public.direct_messages;
create policy "Participants can read direct messages"
  on public.direct_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

 drop policy if exists "Sender can send direct messages" on public.direct_messages;
create policy "Sender can send direct messages"
  on public.direct_messages for insert to authenticated
  with check (auth.uid() = sender_id and sender_id <> recipient_id);

 drop policy if exists "Recipient can mark direct messages read" on public.direct_messages;
create policy "Recipient can mark direct messages read"
  on public.direct_messages for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Restrict updates to the read receipt column so recipients cannot edit message content.
revoke update on public.direct_messages from authenticated;
grant update (read_at) on public.direct_messages to authenticated;

-- Deliberately no delete policy: clients cannot erase conversation history through this table.
