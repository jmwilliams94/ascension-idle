-- Admin Mail ("GM Switchee", 2026-08-13, requested by the user) — an
-- admin-only tool (this developer's own account, gated by a hardcoded
-- email) to send a message plus reward items/currency to one named
-- character or every character, delivered through the existing
-- player-facing Mail system (Market tab -> Mail sub-tab).
--
-- Schema: `mail` gains mail_batch_id/sender_label/message/amount. A single
-- admin send inserts one mail row per reward per recipient, all sharing the
-- same mail_batch_id/sender_label/message -- grouping into one card is a
-- client-only display concern (see MailTab.tsx), NOT a new claim path:
-- claim_mail stays the sole claim RPC, extended to (a) apply a variable
-- `amount` instead of a hardcoded +1, so an admin can send e.g. 5 Lottery
-- Tickets in one row, and (b) handle two new currency kinds (lottery_ticket,
-- ascension_points) alongside the 4 that already existed.
--
-- Ascension Points are account-wide (players.ascension_points), not
-- per-character -- claiming an ascension_points mail row credits the
-- *account* behind the recipient character, same as every other AP-crediting
-- RPC in this project already does via a character_id -> account_id lookup.
--
-- Security: admin_send_mail/admin_lookup_character both compare auth.uid()
-- against `(select id from auth.users where email = <hardcoded email>)` --
-- real, server-side enforcement. Granting `execute ... to authenticated` on
-- both is safe: any non-admin caller just gets back {ok:false,
-- error:'not_admin'}, the check runs before anything is read/written.

-- ============================================================================
-- 1. mail schema additions
-- ============================================================================
alter table public.mail add column if not exists mail_batch_id uuid;
alter table public.mail add column if not exists sender_label text;
alter table public.mail add column if not exists message text;
alter table public.mail add column if not exists amount integer;
alter table public.mail add constraint mail_amount_check check (amount is null or amount > 0);

create index if not exists mail_batch_id_idx on public.mail (mail_batch_id) where mail_batch_id is not null;

alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in ('purchase', 'listing_cancelled', 'listing_expired', 'admin_gift'));

alter table public.mail drop constraint if exists mail_currency_type_check;
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points'));

-- ============================================================================
-- 2. claim_mail -- variable amount + two new currency kinds
-- ============================================================================
create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_amount integer;
  v_new_count integer;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type, amount into v_mail_character_id, v_item_id, v_currency_type, v_amount
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  v_amount := coalesce(v_amount, 1);

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + v_amount where id = p_character_id returning comet_count into v_new_count;
    elsif v_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count + v_amount where id = p_character_id returning fallen_star_count into v_new_count;
    elsif v_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count + v_amount where id = p_character_id
      returning comet_scroll_count into v_new_count;
    elsif v_currency_type = 'fallen_star_scroll' then
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + v_amount where id = p_character_id
      returning fallen_star_scroll_count into v_new_count;
    elsif v_currency_type = 'lottery_ticket' then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_amount where id = p_character_id
      returning lottery_ticket_count into v_new_count;
    else -- 'ascension_points' -- account-wide, not a characters column
      update public.players set ascension_points = ascension_points + v_amount where id = v_account_id
      returning ascension_points into v_new_count;
    end if;

    delete from public.mail where id = p_mail_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  delete from public.mail where id = p_mail_id;

  return jsonb_build_object('ok', true, 'item_id', v_item_id);
end;
$$;

-- ============================================================================
-- 3. admin_send_mail
-- ============================================================================
create or replace function public.admin_send_mail(p_target text, p_message text, p_rewards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_character record;
  v_recipient_count integer := 0;
  v_reward jsonb;
  v_template_id uuid;
  v_required_level integer;
  v_new_item item_instances%rowtype;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  if jsonb_array_length(coalesce(p_rewards, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_rewards');
  end if;

  for v_character in
    select id from public.characters
    where p_target = 'all' or name = trim(p_target)
  loop
    v_recipient_count := v_recipient_count + 1;

    for v_reward in select * from jsonb_array_elements(p_rewards)
    loop
      if v_reward ->> 'type' = 'item' then
        select id, required_level into v_template_id, v_required_level
        from public.item_templates where id = (v_reward ->> 'template_id')::uuid;

        if v_template_id is not null then
          insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, sockets)
          values (
            v_template_id,
            v_character.id,
            coalesce(v_reward ->> 'quality_tier', 'normal'),
            v_required_level,
            coalesce((v_reward ->> 'composition_level')::integer, 0),
            '[]'::jsonb
          )
          returning * into v_new_item;

          insert into public.mail (character_id, item_id, reason, mail_batch_id, sender_label, message)
          values (v_character.id, v_new_item.id, 'admin_gift', v_batch_id, 'GM Switchee', p_message);
        end if;
      elsif v_reward ->> 'type' = 'currency' then
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, message)
        values (
          v_character.id,
          v_reward ->> 'currency_type',
          greatest(1, coalesce((v_reward ->> 'amount')::integer, 1)),
          'admin_gift',
          v_batch_id,
          'GM Switchee',
          p_message
        );
      end if;
    end loop;
  end loop;

  if v_recipient_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'recipient_count', v_recipient_count);
end;
$$;

revoke all on function public.admin_send_mail(text, text, jsonb) from public;
grant execute on function public.admin_send_mail(text, text, jsonb) to authenticated;

-- ============================================================================
-- 4. admin_lookup_character -- recipient preview before sending
-- ============================================================================
create or replace function public.admin_lookup_character(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_character record;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select id, name, class, level into v_character
  from public.characters where name = trim(p_name);

  if v_character.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_character.id,
    'name', v_character.name,
    'class', v_character.class,
    'level', v_character.level
  );
end;
$$;

revoke all on function public.admin_lookup_character(text) from public;
grant execute on function public.admin_lookup_character(text) to authenticated;
