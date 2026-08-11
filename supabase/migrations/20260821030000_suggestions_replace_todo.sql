-- Suggestions (2026-08-21, requested by the user) -- replaces the earlier
-- To-Do board entirely (todo_items/admin_add_todo/admin_remove_todo, added
-- in 20260821010000_todo_and_bug_reports.sql) with a player-submitted
-- suggestion system, same shape as Bug Reports: any player can submit one
-- against their active character and see their own history; only the admin
-- account sees every suggestion across every account and closes one out as
-- Implemented or Rejected with a comment, optionally attaching a
-- currency-only reward (same restriction as Bug Reports -- no gear/weapons)
-- delivered through the existing Mail system.
--
-- Unlike bug_reports' admin SELECT policy (fixed in
-- 20260821020000_fix_bug_reports_admin_rls.sql after it broke by querying
-- auth.users directly inside a RLS USING clause), this one is built on the
-- is_admin() helper from that fix from the start.
begin;

-- ============================================================================
-- 1. Drop the superseded To-Do board entirely -- nothing references it
--    anymore once TodoPanel.tsx/useTodoStore.ts are removed client-side.
-- ============================================================================
drop function if exists public.admin_add_todo(text);
drop function if exists public.admin_remove_todo(uuid);
drop table if exists public.todo_items;

-- ============================================================================
-- 2. suggestions -- same shape as bug_reports, different status enum.
-- ============================================================================
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  character_id uuid not null references public.characters (id) on delete cascade,
  character_name text not null,
  description text not null check (char_length(description) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'implemented', 'rejected')),
  admin_comment text,
  resolved_at timestamptz,
  viewed_at timestamptz
);

create index if not exists suggestions_character_id_idx on public.suggestions (character_id);
create index if not exists suggestions_status_idx on public.suggestions (status);

alter table public.suggestions enable row level security;

do $$ begin
  create policy "Players can view their own suggestions"
    on public.suggestions for select
    using (exists (select 1 from public.characters c where c.id = suggestions.character_id and c.account_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admin can view all suggestions"
    on public.suggestions for select
    using (public.is_admin());
exception when duplicate_object then null;
end $$;

grant select on public.suggestions to authenticated;

create or replace function public.submit_suggestion(p_character_id uuid, p_description text)
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

  select count(*) into v_open_count from public.suggestions where character_id = p_character_id and status = 'open';
  if v_open_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_open_suggestions');
  end if;

  insert into public.suggestions (character_id, character_name, description)
  values (p_character_id, v_character_name, v_description)
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

revoke all on function public.submit_suggestion(uuid, text) from public;
grant execute on function public.submit_suggestion(uuid, text) to authenticated;

-- Admin-only close-out. p_rewards is a jsonb array of {currency_type, amount}
-- objects -- same currency-only restriction as resolve_bug_report, no 'item'
-- reward type support at all.
create or replace function public.resolve_suggestion(
  p_suggestion_id uuid,
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
  v_character_id uuid;
  v_comment text := trim(p_comment);
  v_reward jsonb;
  v_currency_type text;
  v_amount integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_status not in ('implemented', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if v_comment is null or length(v_comment) = 0 then
    return jsonb_build_object('ok', false, 'error', 'comment_required');
  end if;

  select character_id into v_character_id from public.suggestions where id = p_suggestion_id for update;
  if v_character_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.suggestions
  set status = p_status, admin_comment = v_comment, resolved_at = now(), viewed_at = null
  where id = p_suggestion_id;

  for v_reward in select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb))
  loop
    v_currency_type := v_reward ->> 'currency_type';
    v_amount := greatest(1, coalesce((v_reward ->> 'amount')::integer, 1));

    if v_currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points') then
      insert into public.mail (character_id, currency_type, amount, reason, sender_label, subject, message)
      values (v_character_id, v_currency_type, v_amount, 'suggestion_reward', 'GM Switchee', 'Suggestion Reward', v_comment);
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.resolve_suggestion(uuid, text, text, jsonb) from public;
grant execute on function public.resolve_suggestion(uuid, text, text, jsonb) to authenticated;

create or replace function public.mark_suggestions_seen(p_character_id uuid)
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

  update public.suggestions
  set viewed_at = now()
  where character_id = p_character_id and resolved_at is not null and viewed_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_suggestions_seen(uuid) from public;
grant execute on function public.mark_suggestions_seen(uuid) to authenticated;

-- ============================================================================
-- 3. mail_reason_check widened for resolve_suggestion's currency-reward insert
-- ============================================================================
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in ('purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward', 'suggestion_reward'));

commit;
