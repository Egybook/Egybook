-- EgyBook verification request compatibility fix
-- Run in Supabase SQL Editor. The request UI does not collect a subscription plan,
-- so legacy verification_requests.plan must not be required for a verification request.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='verification_requests' and column_name='plan'
  ) then
    execute 'alter table public.verification_requests alter column plan drop not null';
  end if;
end $$;
