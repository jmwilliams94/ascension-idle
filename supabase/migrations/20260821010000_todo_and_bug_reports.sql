-- To-Do board + Bug Reports (2026-08-21, requested by the user) -- two new
-- player-facing tabs:
--   - To-Do: a public read-only roadmap list. Only the admin (same hardcoded
--     email every other admin RPC in this project checks) can add/remove
--     entries, via SECURITY DEFINER RPCs -- no client insert/update/delete
--     grant on the table itself, same "table is read-only to clients, all
--     mutation goes through an RPC" shape as global_announcements.
--   - Bug Reports: any player can submit one against their active character
--     and see their own report history. Only the admin can see every
--     report across every account (an additive RLS policy, same OR'd-
--     policies pattern as marketplace_listings' actively-listed items) and
--     close one out as Fixed/Rewarded with a comment. A "Rewarded" close can
--     attach currency rewards (Comet/Fallen Star/their Scrolls/Lottery
--     Ticket/Ascension Points only -- deliberately no gear/weapon reward
--     path exists here, unlike Admin Mail) delivered through the existing
--     Mail system, reusing its currency-claim machinery as-is.
begin;

-- ============================================================================
-- 1. todo_items
-- ============================================================================
create table if not exists public.todo_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  content text not null check (char_length(content) between 1 and 500)
);

alter table public.todo_items enable row level security;

do $$ begin
  create policy "Todo items are publicly viewable"
    on public.todo_items for select
    using (true);
exception when duplicate_object then null;
end $$;

grant select on public.todo_items to authenticated;

create or replace function public.admin_add_todo(p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_content text := trim(p_content);
  v_new_id uuid;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if v_content is null or length(v_content) = 0 then
    return jsonb_build_object('ok', false, 'error', 'content_required');
  end if;

  insert into public.todo_items (content) values (v_content) returning id into v_new_id;
  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

revoke all on function public.admin_add_todo(text) from public;
grant execute on function public.admin_add_todo(text) to authenticated;

create or replace function public.admin_remove_todo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  delete from public.todo_items where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_remove_todo(uuid) from public;
grant execute on function public.admin_remove_todo(uuid) to authenticated;

-- ============================================================================
-- 2. bug_reports
-- ============================================================================
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  character_id uuid not null references public.characters (id) on delete cascade,
  -- Snapshot, not a join (2026-08-21) -- characters has no cross-account
  -- SELECT policy, so the admin's "view every report" query below couldn't
  -- otherwise show who reported what. Same reasoning as marketplace's
  -- seller_character_name/chat's server-captured display name elsewhere in
  -- this project.
  character_name text not null,
  description text not null check (char_length(description) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'fixed', 'rewarded')),
  admin_comment text,
  resolved_at timestamptz,
  -- null = the reporter hasn't seen this report's resolution yet (mirrors
  -- Mail's claimed_at-is-null "unread" convention). Only ever meaningful once
  -- resolved_at is set -- an open report has no resolution to view yet.
  viewed_at timestamptz
);

create index if not exists bug_reports_character_id_idx on public.bug_reports (character_id);
create index if not exists bug_reports_status_idx on public.bug_reports (status);

alter table public.bug_reports enable row level security;

do $$ begin
  create policy "Players can view their own bug reports"
    on public.bug_reports for select
    using (exists (select 1 from public.characters c where c.id = bug_reports.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admin can view all bug reports"
    on public.bug_reports for select
    using (auth.uid() = (select id from auth.users where email = 'jmwilliams94@icloud.com'));
exception when duplicate_object then null;
end $$;

grant select on public.bug_reports to authenticated;

create or replace function public.submit_bug_report(p_character_id uuid, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_description text := trim(p_description);
  v_open_count integer;
  v_new_id uuid;
begin
  select account_id, name into v_account_id, v_character_name from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_description is null or length(v_description) = 0 then
    return jsonb_build_object('ok', false, 'error', 'description_required');
  end if;

  -- Light abuse guard on an otherwise-open write path (any authenticated
  -- player can call this) -- caps how many still-open reports one character
  -- can stack up, not a rate limit on submitting in general.
  select count(*) into v_open_count from public.bug_reports where character_id = p_character_id and status = 'open';
  if v_open_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_open_reports');
  end if;

  insert into public.bug_reports (character_id, character_name, description)
  values (p_character_id, v_character_name, v_description)
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

revoke all on function public.submit_bug_report(uuid, text) from public;
grant execute on function public.submit_bug_report(uuid, text) to authenticated;

-- Admin-only close-out. p_rewards is a jsonb array of {currency_type, amount}
-- objects -- deliberately no 'item' reward type support at all (unlike
-- admin_send_mail), matching the user's explicit "don't include rewarding
-- gear/weapons." Delivered via the existing mail table/claim_mail RPC, so no
-- new claim path is needed client-side.
create or replace function public.resolve_bug_report(
  p_report_id uuid,
  p_status text,
  p_comment text,
  p_rewards jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_comment text := trim(p_comment);
  v_character_id uuid;
  v_reward jsonb;
  v_currency_type text;
  v_amount integer;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_status not in ('fixed', 'rewarded') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if v_comment is null or length(v_comment) = 0 then
    return jsonb_build_object('ok', false, 'error', 'comment_required');
  end if;

  select character_id into v_character_id from public.bug_reports where id = p_report_id for update;
  if v_character_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.bug_reports
  set status = p_status, admin_comment = v_comment, resolved_at = now(), viewed_at = null
  where id = p_report_id;

  for v_reward in select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb))
  loop
    v_currency_type := v_reward ->> 'currency_type';
    v_amount := greatest(1, coalesce((v_reward ->> 'amount')::integer, 1));

    if v_currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points') then
      insert into public.mail (character_id, currency_type, amount, reason, sender_label, subject, message)
      values (v_character_id, v_currency_type, v_amount, 'bug_report_reward', 'GM Switchee', 'Bug Report Reward', v_comment);
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.resolve_bug_report(uuid, text, text, jsonb) from public;
grant execute on function public.resolve_bug_report(uuid, text, text, jsonb) to authenticated;

create or replace function public.mark_bug_reports_seen(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.bug_reports
  set viewed_at = now()
  where character_id = p_character_id and resolved_at is not null and viewed_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_bug_reports_seen(uuid) from public;
grant execute on function public.mark_bug_reports_seen(uuid) to authenticated;

-- ============================================================================
-- 3. mail_reason_check widened for resolve_bug_report's currency-reward insert
-- ============================================================================
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in ('purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward'));

commit;
