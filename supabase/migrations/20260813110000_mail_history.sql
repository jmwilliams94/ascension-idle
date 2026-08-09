-- Mail history (2026-08-13, requested by the user) -- claiming a mail no
-- longer deletes its row; it marks `claimed_at` instead, so claimed mail
-- stays visible as browsable history until the player explicitly clears it
-- (clear_mail_history, new below) -- which only ever removes already-claimed
-- rows, so an unclaimed reward can never be lost that way. Also adds a real
-- `subject` field the Admin Mail composer fills in (separate from the
-- message body, like a real inbox) -- Market-originated mail (purchase/
-- listing_cancelled/listing_expired) has no admin-set subject; the client
-- falls back to its existing reasonLabel text for those (see MailTab.tsx).

-- ============================================================================
-- 1. mail schema additions
-- ============================================================================
alter table public.mail add column if not exists claimed_at timestamptz;
alter table public.mail add column if not exists subject text;

-- ============================================================================
-- 2. claim_mail -- mark claimed instead of deleting, idempotency guard
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
  v_claimed_at timestamptz;
  v_new_count integer;
  v_new_claimed_at timestamptz;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type, amount, claimed_at
  into v_mail_character_id, v_item_id, v_currency_type, v_amount, v_claimed_at
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  -- A row can only ever be claimed once -- its reward can only ever be
  -- granted once. Guards against a double-claim (e.g. a stale client retry)
  -- silently re-crediting currency now that the row isn't deleted anymore.
  if v_claimed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
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

    update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

    return jsonb_build_object(
      'ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count, 'claimed_at', v_new_claimed_at
    );
  end if;

  update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

  return jsonb_build_object('ok', true, 'item_id', v_item_id, 'claimed_at', v_new_claimed_at);
end;
$$;

-- ============================================================================
-- 3. clear_mail_history -- player-facing, only ever removes claimed rows
-- ============================================================================
create or replace function public.clear_mail_history(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_cleared_count integer;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  with deleted as (
    delete from public.mail
    where character_id = p_character_id and claimed_at is not null
    returning id
  )
  select count(*) into v_cleared_count from deleted;

  return jsonb_build_object('ok', true, 'cleared_count', v_cleared_count);
end;
$$;

revoke all on function public.clear_mail_history(uuid) from public;
grant execute on function public.clear_mail_history(uuid) to authenticated;

-- ============================================================================
-- 4. admin_send_mail -- adds p_subject (signature change: 3 args -> 4 args)
-- ============================================================================
-- The old 3-arg signature must be dropped explicitly first -- create or
-- replace on a different arg list creates a second overload rather than
-- replacing it (the same gotcha already documented elsewhere in this
-- project, e.g. draw_lucky_ticket's p_use_ticket addition).
drop function if exists public.admin_send_mail(text, text, jsonb);

create or replace function public.admin_send_mail(p_target text, p_subject text, p_message text, p_rewards jsonb)
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

  if p_subject is null or length(trim(p_subject)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'subject_required');
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

          insert into public.mail (character_id, item_id, reason, mail_batch_id, sender_label, subject, message)
          values (v_character.id, v_new_item.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
        end if;
      elsif v_reward ->> 'type' = 'currency' then
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (
          v_character.id,
          v_reward ->> 'currency_type',
          greatest(1, coalesce((v_reward ->> 'amount')::integer, 1)),
          'admin_gift',
          v_batch_id,
          'GM Switchee',
          p_subject,
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

revoke all on function public.admin_send_mail(text, text, text, jsonb) from public;
grant execute on function public.admin_send_mail(text, text, text, jsonb) to authenticated;
