-- "Send to all" admin mail looped over every character row, so an account with
-- multiple characters received (and could claim) the reward once per character
-- instead of once per account. Dedupe p_target = 'all' to one character per
-- account_id (earliest-created), same as picking a single recipient per account.
-- Named-target sends are unaffected (character name is globally unique).
begin;

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
  v_slot_type text;
  v_quality_tier text;
  v_composition_level integer;
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
    select distinct on (c.account_id) c.id
    from public.characters c
    where p_target = 'all' or c.name = trim(p_target)
    order by c.account_id, c.created_at asc
  loop
    v_recipient_count := v_recipient_count + 1;

    if v_reward_count = 0 then
      insert into public.mail (character_id, reason, mail_batch_id, sender_label, subject, message)
      values (v_character.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
    else
      for v_reward in select * from jsonb_array_elements(p_rewards)
      loop
        if v_reward ->> 'type' = 'item' then
          select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
          from public.item_templates where id = (v_reward ->> 'template_id')::uuid;

          if v_template_id is not null then
            v_quality_tier := coalesce(v_reward ->> 'quality_tier', 'normal');
            v_composition_level := coalesce((v_reward ->> 'composition_level')::integer, 0);

            insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, sockets, durability)
            values (
              v_template_id,
              v_character.id,
              v_quality_tier,
              v_required_level,
              v_composition_level,
              '[]'::jsonb,
              coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
            )
            returning * into v_new_item;

            insert into public.mail
              (character_id, item_id, reason, mail_batch_id, sender_label, subject, message,
               item_template_id, item_quality_tier, item_level, item_composition_level)
            values
              (v_character.id, v_new_item.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message,
               v_template_id, v_quality_tier, v_required_level, v_composition_level);
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

commit;
