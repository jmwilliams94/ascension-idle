-- Message-only mail (2026-08-13, requested by the user) -- allows sending
-- mail with just a Subject + Message and no attached item/currency reward.
-- `mail_target_check` used to require *exactly* one of item_id/currency_type
-- (an XOR) -- loosened to "at most one," so a row can now have neither.
-- Claiming a message-only row already works unchanged: claim_mail's
-- currency_type branch is skipped (null) and the item branch just returns a
-- null item_id, so it falls straight through to marking claimed_at -- no
-- RPC change needed there, this is purely admin_send_mail + the constraint.
alter table public.mail drop constraint if exists mail_target_check;
alter table public.mail add constraint mail_target_check
  check (not (item_id is not null and currency_type is not null));

-- Same (text, text, text, jsonb) signature as before -- create or replace is
-- safe. p_rewards may now be an empty array: when it is, exactly one plain
-- mail row (subject/message, no item_id/currency_type) is inserted per
-- recipient instead of looping rewards.
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
  v_reward_count integer;
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

  v_reward_count := jsonb_array_length(coalesce(p_rewards, '[]'::jsonb));

  for v_character in
    select id from public.characters
    where p_target = 'all' or name = trim(p_target)
  loop
    v_recipient_count := v_recipient_count + 1;

    if v_reward_count = 0 then
      insert into public.mail (character_id, reason, mail_batch_id, sender_label, subject, message)
      values (v_character.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
    else
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
    end if;
  end loop;

  if v_recipient_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'recipient_count', v_recipient_count);
end;
$$;
