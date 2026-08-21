-- Gold Donation Event: pay donor rewards out the moment the pool's target is
-- reached, instead of waiting for the buff window (a separate 30-60 minute
-- gameplay effect) to expire. Mirrors apply_world_boss_attack's pay-on-
-- killing-blow (20260908000000_world_boss_reward_on_kill.sql) -- since
-- donate_gold only accepts donations while status = 'collecting', the
-- participant totals/leaderboard are already final the instant the
-- threshold-crossing donation lands, so there's no reason to hold rewards
-- back for the buff's own duration.
--
-- Also lowers the target roll from 30M-50M to 15M-30M (whole-million
-- increments, 16 possible values), same "only affects pools rolled after
-- this migration" scoping as the previous 20260921000000 range change -- the
-- currently open pool keeps its existing target_amount.
begin;

-- ============================================================================
-- 1. donate_gold: pay rewards immediately on the donation that crosses the
--    threshold, right alongside rolling the buff. Safe against double-
--    rolling/double-paying for the same reason the buff roll already was --
--    the pool row has been FOR UPDATE-locked since before this donation's
--    own gold debit, so no concurrent donate_gold call against the same pool
--    can be mid-flight.
-- ============================================================================
create or replace function public.donate_gold(p_character_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold bigint;
  v_pool_id uuid;
  v_status text;
  v_target_amount bigint;
  v_pool_total bigint;
  v_participant_total bigint;
  v_category text;
  v_multiplier numeric;
  v_duration_minutes integer;
  v_batch_id uuid;
  v_reward_participant record;
  v_reward record;
  v_message text;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Lazy lifecycle trigger first — mirrors apply_world_boss_attack calling
  -- ensure_world_boss_spawn() before validating anything.
  perform public.ensure_gold_donation_pool();

  select account_id, gold into v_account_id, v_gold
  from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_gold < p_amount then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold', v_gold);
  end if;

  select current_pool_id into v_pool_id from public.gold_donation_state where id = 1;

  select status, target_amount into v_status, v_target_amount
  from public.gold_donation_pools where id = v_pool_id for update;

  if v_status <> 'collecting' then
    return jsonb_build_object('ok', false, 'error', 'pool_not_collecting');
  end if;

  update public.characters set gold = gold - p_amount where id = p_character_id
  returning gold into v_gold;

  insert into public.gold_donation_participants (pool_id, character_id)
  values (v_pool_id, p_character_id)
  on conflict (pool_id, character_id) do nothing;

  update public.gold_donation_participants
  set total_donated = total_donated + p_amount, last_donated_at = now()
  where pool_id = v_pool_id and character_id = p_character_id
  returning total_donated into v_participant_total;

  update public.gold_donation_pools
  set total_donated = total_donated + p_amount
  where id = v_pool_id
  returning total_donated into v_pool_total;

  if v_pool_total >= v_target_amount then
    v_category := (array['exp', 'socket_unlock', 'comet', 'fallen_star', 'quality_tier'])[1 + floor(random() * 5)::int];
    v_multiplier := round((2 + random() * 3)::numeric, 2); -- x2.00-x5.00, uniform, even weighting
    v_duration_minutes := 30 + floor(random() * 31)::int; -- 30-60 inclusive, whole-minute increments

    update public.gold_donation_pools
    set status = 'active',
        buff_category = v_category,
        buff_multiplier = v_multiplier,
        buff_started_at = now(),
        buff_ends_at = now() + (v_duration_minutes || ' minutes')::interval
    where id = v_pool_id;

    -- Threshold just crossed on this donation — pay donor rewards out now.
    -- The buff itself keeps running its own 30-60 minute course independent
    -- of this payout; ensure_gold_donation_pool's active-buff-expired branch
    -- below is left as a fallback and no-ops the payout since
    -- rewards_distributed_at is already set here.
    v_batch_id := gen_random_uuid();

    for v_reward_participant in
      select character_id, total_donated, row_number() over (order by total_donated desc) as rn
      from public.gold_donation_participants
      where pool_id = v_pool_id
    loop
      v_message := case v_reward_participant.rn
        when 1 then 'You were the top donor in the Gold Donation Event!'
        when 2 then 'You placed 2nd in the Gold Donation Event!'
        when 3 then 'You placed 3rd in the Gold Donation Event!'
        else 'Thanks for donating to the Gold Donation Event!'
      end;

      for v_reward in select * from public.gold_donation_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
      end loop;

      if v_reward_participant.rn <= 3 then
        for v_reward in
          select * from public.gold_donation_reward_for_tier(
            case v_reward_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'gold_donation_reward', v_batch_id, 'Gold Donation Event', 'Donation Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.gold_donation_pools set rewards_distributed_at = now() where id = v_pool_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'gold_remaining', v_gold,
    'pool_total_donated', v_pool_total,
    'pool_target', v_target_amount,
    'triggered_buff', v_pool_total >= v_target_amount,
    'participant_total_donated', v_participant_total
  );
end;
$$;

revoke all on function public.donate_gold(uuid, integer) from public;
grant execute on function public.donate_gold(uuid, integer) to authenticated;

-- ============================================================================
-- 2. ensure_gold_donation_pool: active-buff-expired branch now skips the
--    payout loop when rewards_distributed_at is already set (donate_gold
--    already paid it out at the threshold-crossing donation) — otherwise a
--    pool that triggered its buff would get its donors mailed rewards twice
--    once the buff window later expires. Kept as a fallback path (mirrors
--    ensure_world_boss_spawn) rather than removed outright. Target roll also
--    lowered 30M-50M -> 15M-30M, whole-million increments (16 values).
-- ============================================================================
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
  v_rewards_distributed_at timestamptz;
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

  select status, buff_ends_at, rewards_distributed_at
  into v_status, v_buff_ends_at, v_rewards_distributed_at
  from public.gold_donation_pools where id = v_pool_id;

  if v_status = 'collecting' then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' and now() < v_buff_ends_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  if v_status = 'active' then
    -- Buff window just expired under this caller's watch. Fallback payout
    -- path only — donate_gold already pays rewards out the instant the
    -- threshold is crossed, so rewards_distributed_at is normally already
    -- set by the time we get here.
    if v_rewards_distributed_at is null then
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
    end if;

    update public.gold_donation_pools set status = 'ended', rewards_distributed_at = coalesce(rewards_distributed_at, now()) where id = v_pool_id;
    update public.gold_donation_state set next_pool_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- status = 'ended': gap in progress, or gap just elapsed.
  if v_next_pool_at is null or now() < v_next_pool_at then
    return jsonb_build_object('ok', true, 'pool', (select to_jsonb(p) from public.gold_donation_pools p where p.id = v_pool_id));
  end if;

  -- 15M-30M, whole-million increments: 15,000,000 + (0..15) * 1,000,000.
  v_target := (15000000 + (floor(random() * 16))::bigint * 1000000);
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
