-- EgyBook Realtime Phase 2: READ-ONLY diagnostics
-- Safe to run in Supabase SQL Editor. This script does not alter schema, data,
-- policies, publications, or replication settings.

-- 1) Actual columns and types for the tables used by EgyBook Realtime.
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'notifications', 'direct_messages', 'call_signals',
    'posts', 'friend_requests', 'post_reactions', 'post_comments'
  )
order by c.table_name, c.ordinal_position;

-- 2) RLS enabled/forced state for those tables.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'notifications', 'direct_messages', 'call_signals',
    'posts', 'friend_requests', 'post_reactions', 'post_comments'
  )
order by c.relname;

-- 3) Existing policies (especially important before changing call_signals filters).
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'notifications', 'direct_messages', 'call_signals',
    'posts', 'friend_requests', 'post_reactions', 'post_comments'
  )
order by tablename, policyname;

-- 4) Which of these tables are currently in the Supabase Realtime publication?
select
  pubname,
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'notifications', 'direct_messages', 'call_signals',
    'posts', 'friend_requests', 'post_reactions', 'post_comments'
  )
order by tablename;

-- 5) Indexes on recipient_id / post_id / conversation-related columns.
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'notifications', 'direct_messages', 'call_signals',
    'posts', 'friend_requests', 'post_reactions', 'post_comments'
  )
order by tablename, indexname;
