-- Lower Gold Donation Event's target roll from the original 50M-100M
-- (fully granular integer) to 30M-50M in whole-million increments (30M,
-- 31M, ..., 50M — 21 possible values). Only affects pools rolled after this
-- migration runs (ensure_gold_donation_pool's collecting->ended->new-pool
-- branch); the currently open/active pool keeps its existing target_amount.
begin;

create or replace function public.ensure_gold_donation_pool()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool_id uuid;
  v_next_pool_at timestamptz;
  v_status text;
  v_buff_ends_at timestamptz;
  v_new_pool_id uuid;
  v_target bigint;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
begin
  -- Global mutex, same accepted-brief-lock-hold reasoning as
  -- ensure_world_boss_spawn's world_boss_state lock.
  select current_pool_id, next_pool_at into v_pool_id, v_next_pool_at
  from public.gold_donation_state where id = 1 for update;

  select status, buff_ends_at into v_status, v_buff_ends_at
  from public.gold_donation_pools where id = v_pool_id;

  if v_status = 'collecting' then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' and now() < v_buff_ends_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' then
    -- Buff window just expired under this caller's watch — pay out and
    -- start the gap, same "second caller only sees the result" idempotency
    -- as ensure_world_boss_spawn.
    for v_participant in
      select character_id, total_donated, row_number() over (order by total_donated desc) as rn
      from public.gold_donation_participants
      where pool_id = v_pool_id
    loop
      v_message := case v_participant.rn
        when 1 then 'You were the top donor in the Gold Donation Event!'
        when 2 then 'You placed 2nd in the Gold Donation Event!'
        when 3 then 'You placed 3rd in the Gold Donation Event!'
        else 'Thanks for donating to the Gold Donation Event!'
      end;

      for v_reward in select * from public.gold_donation_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
      end loop;

      if v_participant.rn <= 3 then
        for v_reward in
          select * from public.gold_donation_reward_for_tier(
            case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.gold_donation_pools set status = 'ended', rewards_distributed_at = now() where id = v_pool_id;
    update public.gold_donation_state set next_pool_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- status = 'ended': gap in progress, or gap just elapsed.
  if v_next_pool_at is null or now() < v_next_pool_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- 30M-50M, whole-million increments: 30,000,000 + (0..20) * 1,000,000.
  v_target := (30000000 + (floor(random() * 21))::bigint * 1000000);
  insert into public.gold_donation_pools (target_amount, total_donated, status)
  values (v_target, 0, 'collecting')
  returning id into v_new_pool_id;

  update public.gold_donation_state set current_pool_id = v_new_pool_id, next_pool_at = null where id = 1;

  return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_new_pool_id));
end;
$$;

revoke all on function public.ensure_gold_donation_pool() from public;
grant execute on function public.ensure_gold_donation_pool() to authenticated;

commit;
