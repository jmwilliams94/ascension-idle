-- Reply threads (2026-08-21, requested by the user) -- lets a player and the
-- admin go back and forth on an individual Suggestion or Bug Report, rather
-- than the one-shot admin_comment set only at close time. One shared table
-- (report_replies) covers both parent types via two nullable FKs + an XOR
-- check constraint -- same pattern mail's item_id/currency_type pair already
-- established -- avoiding a whole duplicated table+RLS+RPC set for what is
-- genuinely one feature attached to two different parents.
begin;

create table if not exists public.report_replies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bug_report_id uuid references public.bug_reports (id) on delete cascade,
  suggestion_id uuid references public.suggestions (id) on delete cascade,
  author_type text not null check (author_type in ('player', 'admin')),
  author_name text not null,
  message text not null check (char_length(message) between 1 and 1000),
  constraint report_replies_target_check check (
    (bug_report_id is not null and suggestion_id is null) or
    (bug_report_id is null and suggestion_id is not null)
  )
);

create index if not exists report_replies_bug_report_id_idx on public.report_replies (bug_report_id);
create index if not exists report_replies_suggestion_id_idx on public.report_replies (suggestion_id);

alter table public.report_replies enable row level security;

do $$ begin
  create policy "Players can view replies on their own reports"
    on public.report_replies for select
    using (
      exists (
        select 1 from public.bug_reports br
        join public.characters c on c.id = br.character_id
        where br.id = report_replies.bug_report_id and c.account_id = auth.uid()
      )
      or exists (
        select 1 from public.suggestions s
        join public.characters c on c.id = s.character_id
        where s.id = report_replies.suggestion_id and c.account_id = auth.uid()
      )
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admin can view all replies"
    on public.report_replies for select
    using (public.is_admin());
exception when duplicate_object then null;
end $$;

grant select on public.report_replies to authenticated;

-- ============================================================================
-- Player-facing reply RPCs -- ownership-checked both ways: the character
-- must belong to the caller's account, AND must be the actual owner of the
-- report/suggestion being replied to (a player could otherwise pass any
-- report id and post into someone else's thread).
-- ============================================================================
create or replace function public.reply_to_bug_report(p_character_id uuid, p_report_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_report_character_id uuid;
  v_message text := trim(p_message);
begin
  select account_id, name into v_account_id, v_character_name from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_message is null or length(v_message) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  select character_id into v_report_character_id from public.bug_reports where id = p_report_id;
  if v_report_character_id is null or v_report_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.report_replies (bug_report_id, author_type, author_name, message)
  values (p_report_id, 'player', v_character_name, v_message);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reply_to_bug_report(uuid, uuid, text) from public;
grant execute on function public.reply_to_bug_report(uuid, uuid, text) to authenticated;

create or replace function public.reply_to_suggestion(p_character_id uuid, p_suggestion_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_suggestion_character_id uuid;
  v_message text := trim(p_message);
begin
  select account_id, name into v_account_id, v_character_name from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_message is null or length(v_message) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  select character_id into v_suggestion_character_id from public.suggestions where id = p_suggestion_id;
  if v_suggestion_character_id is null or v_suggestion_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.report_replies (suggestion_id, author_type, author_name, message)
  values (p_suggestion_id, 'player', v_character_name, v_message);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reply_to_suggestion(uuid, uuid, text) from public;
grant execute on function public.reply_to_suggestion(uuid, uuid, text) to authenticated;

-- ============================================================================
-- Admin-facing reply RPCs.
-- ============================================================================
create or replace function public.admin_reply_bug_report(p_report_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := trim(p_message);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if v_message is null or length(v_message) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  if not exists (select 1 from public.bug_reports where id = p_report_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.report_replies (bug_report_id, author_type, author_name, message)
  values (p_report_id, 'admin', 'GM Switchee', v_message);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_reply_bug_report(uuid, text) from public;
grant execute on function public.admin_reply_bug_report(uuid, text) to authenticated;

create or replace function public.admin_reply_suggestion(p_suggestion_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := trim(p_message);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if v_message is null or length(v_message) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  if not exists (select 1 from public.suggestions where id = p_suggestion_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.report_replies (suggestion_id, author_type, author_name, message)
  values (p_suggestion_id, 'admin', 'GM Switchee', v_message);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_reply_suggestion(uuid, text) from public;
grant execute on function public.admin_reply_suggestion(uuid, text) to authenticated;

-- ============================================================================
-- resolve_bug_report/resolve_suggestion now also drop the closing comment
-- into the thread (author_type='admin') so the conversation reads naturally
-- end-to-end. admin_comment itself is untouched -- still the at-a-glance
-- summary shown without expanding the thread. Same (uuid, text, text, jsonb)
-- signature as before on both -- create or replace is safe, no drop needed.
-- ============================================================================
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
  v_character_id uuid;
  v_comment text := trim(p_comment);
  v_reward jsonb;
  v_currency_type text;
  v_amount integer;
begin
  if not public.is_admin() then
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

  insert into public.report_replies (bug_report_id, author_type, author_name, message)
  values (p_report_id, 'admin', 'GM Switchee', v_comment);

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

  insert into public.report_replies (suggestion_id, author_type, author_name, message)
  values (p_suggestion_id, 'admin', 'GM Switchee', v_comment);

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

commit;
