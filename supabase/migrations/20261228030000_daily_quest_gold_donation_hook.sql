-- Hooks the Gold Donation daily quest into donate_gold -- any successful
-- donation of any size counts (the function already rejects <= 0 upstream).
-- Full body copied verbatim from
-- 20261111000000_gold_donation_socket_unlock_capped_buff.sql, with one line
-- added right after the participant's total_donated is updated. Same
-- signature; donate_gold is SECURITY DEFINER, so this call runs as the
-- function owner regardless of who invokes the RPC.
begin;

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
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Lazy lifecycle trigger first -- mirrors apply_world_boss_attack calling
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

  -- Daily Quest hook: any successful donation of any size counts.
  perform public.bump_daily_quest_progress(p_character_id, 'gold_donation');

  update public.gold_donation_pools
  set total_donated = total_donated + p_amount
  where id = v_pool_id
  returning total_donated into v_pool_total;

  -- Buff rolled inline, on the exact donation that crosses the threshold.
  -- Safe against double-rolling: the pool row has been FOR UPDATE-locked
  -- since before this donation's own gold debit, so no concurrent
  -- donate_gold call against the same pool can be mid-flight -- Postgres
  -- blocks a second caller's own FOR UPDATE on this row until this
  -- transaction commits, at which point v_status will already read 'active'
  -- for them.
  if v_pool_total >= v_target_amount then
    v_category := (array['exp', 'socket_unlock', 'comet', 'fallen_star', 'quality_tier'])[1 + floor(random() * 5)::int];

    if v_category = 'socket_unlock' then
      v_multiplier := round((1 + random() * 0.99)::numeric, 2); -- x1.00-x1.99
      v_duration_minutes := 5 + floor(random() * 6)::int; -- 5-10 inclusive, whole minutes
    else
      v_multiplier := round((2 + random() * 3)::numeric, 2); -- x2.00-x5.00, uniform, even weighting
      v_duration_minutes := 30 + floor(random() * 31)::int; -- 30-60 inclusive, whole-minute increments
    end if;

    update public.gold_donation_pools
    set status = 'active',
        buff_category = v_category,
        buff_multiplier = v_multiplier,
        buff_started_at = now(),
        buff_ends_at = now() + (v_duration_minutes || ' minutes')::interval
    where id = v_pool_id;
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

commit;
