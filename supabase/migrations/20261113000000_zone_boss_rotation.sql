-- Zone Boss (2026-11-13): the single fixed World Boss (Mourncrow/Windhollow
-- only) becomes 8 bosses, one per zone, randomly rotating on the exact same
-- lifecycle timing the old system already used (6-8h attackable window,
-- silent 1-6h gap, reward-on-kill). Table/function/Edge-Function names stay
-- world_boss_* internally (a deliberate scope-limiting call — see the plan,
-- "gentle-plotting-beaver" — renaming DB objects would mean re-granting/
-- re-publishing/redeploying for zero player-visible benefit); only the
-- lifecycle logic and the reward-mail copy change here. Player-facing
-- "World Boss" -> "Zone Boss" renaming happens client-side only.
--
-- Each boss gets its own physical_defense/magic_defense (new columns on
-- world_boss_spawns) instead of one flat BOSS_DEFENSE, scaled to its home
-- zone's top level. This is the first real use of a physical/magic damage
-- SPLIT anywhere in this game — world-boss-attack/index.ts (not touched by
-- this migration, see that file's own edit) mitigates a character's
-- physical- and magic-sourced damage against these two numbers separately
-- before summing, instead of collapsing both into one attackMidpoint
-- resolved against one flat defense number like every other combat path
-- still does.
--
-- world_boss_gather_attack_state and get_world_boss_leaderboard need NO
-- changes: the former already returns to_jsonb(spawn_row) wholesale, so the
-- new columns appear in its response automatically; the latter never touched
-- boss identity at all.
begin;

-- ============================================================================
-- 1. Schema: per-spawn boss identity + defense split, plus the "don't repeat
--    the boss that just ended" pointer.
-- ============================================================================
alter table public.world_boss_spawns
  add column boss_id text not null default 'mourncrow',
  add column physical_defense integer not null default 200,
  add column magic_defense integer not null default 200;

alter table public.world_boss_state add column last_boss_id text;

-- ============================================================================
-- 2. zone_boss_catalog — the single source of truth for the 8 bosses' static
--    data (id/display name/home zone's top level/defense specialty). Used
--    both to roll a new spawn's stats and to name the boss in reward mail.
--    Internal helper only, same "revoke from public, still callable by an
--    owner-context caller" pattern as world_boss_reward_for_tier.
-- ============================================================================
create or replace function public.zone_boss_catalog()
returns table (boss_id text, display_name text, zone_top_level integer, defense_profile text)
language sql
immutable
as $$
  select * from (values
    ('mourncrow', 'Mourncrow', 25, 'magical'),
    ('emberroot', 'Emberroot', 45, 'physical'),
    ('thundermane', 'Thundermane', 65, 'magical'),
    ('karthos', 'Karthos', 85, 'physical'),
    ('skytalon', 'Skytalon', 100, 'physical'),
    ('nyxharrow', 'Nyxharrow', 120, 'magical'),
    ('twistpath-warden', 'Twistpath Warden', 120, 'physical'),
    ('glacius', 'Glacius', 129, 'magical')
  ) as t(boss_id, display_name, zone_top_level, defense_profile);
$$;

revoke all on function public.zone_boss_catalog() from public;

-- ============================================================================
-- 3. mail: 'zone_boss_reward' is the new reason going forward.
--    'world_boss_reward' stays valid too — real unclaimed mail with that
--    reason may already be sitting in players' inboxes (mail rows are never
--    deleted, see CLAUDE.md's claimed_at-filter gotcha), and MarketplacePanel
--    still needs to render it correctly.
-- ============================================================================
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in (
    'purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward',
    'suggestion_reward', 'world_boss_reward', 'zone_boss_reward', 'gold_donation_reward', 'sale_notification'
  ));

-- ============================================================================
-- 4. ensure_world_boss_spawn — full body from 20261011000000's version (the
--    latest), with two real changes:
--    a) the "gap elapsed, roll the next spawn" branch now picks a random
--       boss (excluding whichever one just ended) from zone_boss_catalog()
--       and derives max_hp/physical_defense/magic_defense from it, instead
--       of a flat max_hp := 50000.
--    b) the window-expiry reward-payout branch now names the specific boss
--       that was just defeated/timed out in the mail copy/sender/reason,
--       instead of the static "World Boss" text.
-- ============================================================================
create or replace function public.ensure_world_boss_spawn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_spawn_id uuid;
  v_next_spawn_at timestamptz;
  v_last_boss_id text;
  v_status text;
  v_window_ends_at timestamptz;
  v_max_hp bigint;
  v_rewards_distributed_at timestamptz;
  v_ending_boss_id text;
  v_boss_display_name text;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
  v_top5_text text;
  v_boss_id text;
  v_zone_top_level integer;
  v_defense_profile text;
  v_base_defense integer;
  v_physical_defense integer;
  v_magic_defense integer;
begin
  select current_spawn_id, next_spawn_at, last_boss_id
  into v_current_spawn_id, v_next_spawn_at, v_last_boss_id
  from public.world_boss_state where id = 1 for update;

  select status, window_ends_at, max_hp, rewards_distributed_at, boss_id
  into v_status, v_window_ends_at, v_max_hp, v_rewards_distributed_at, v_ending_boss_id
  from public.world_boss_spawns where id = v_current_spawn_id;

  -- 1. Still in-window: unchanged fast path.
  if v_status = 'active' and now() < v_window_ends_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- 2. Window just expired under this caller: pay out rewards, unless a
  -- killing blow already paid them out early (apply_world_boss_attack sets
  -- rewards_distributed_at the moment the boss dies) — then just close out.
  if v_status = 'active' then
    if v_rewards_distributed_at is null then
      select display_name into v_boss_display_name from public.zone_boss_catalog() where boss_id = v_ending_boss_id;
      v_boss_display_name := coalesce(v_boss_display_name, 'Zone Boss');

      select 'Top 5:' || E'\n' || coalesce(string_agg(
        format('%s. %s — %s damage', ranked.rn, ranked.character_name, to_char(ranked.total_damage, 'FM999,999,999,999')),
        E'\n' order by ranked.rn
      ), '(no participants)')
      into v_top5_text
      from (
        select row_number() over (order by wbp.total_damage desc) as rn, c.name as character_name, wbp.total_damage
        from public.world_boss_participants wbp
        join public.characters c on c.id = wbp.character_id
        where wbp.spawn_id = v_current_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
        order by wbp.total_damage desc
        limit 5
      ) ranked;

      for v_participant in
        select character_id, total_damage, row_number() over (order by total_damage desc) as rn
        from public.world_boss_participants
        where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0
      loop
        v_message := (case v_participant.rn
          when 1 then 'You placed 1st in the ' || v_boss_display_name || ' fight!'
          when 2 then 'You placed 2nd in the ' || v_boss_display_name || ' fight!'
          when 3 then 'You placed 3rd in the ' || v_boss_display_name || ' fight!'
          else 'Thanks for fighting ' || v_boss_display_name || '!'
        end) || E'\n\n' || v_top5_text;

        for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
        end loop;

        if v_participant.rn <= 3 then
          for v_reward in
            select * from public.world_boss_reward_for_tier(
              case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
            )
          loop
            insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
            values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
          end loop;
        end if;
      end loop;
    end if;

    update public.world_boss_spawns set status = 'ended', rewards_distributed_at = coalesce(rewards_distributed_at, now()) where id = v_current_spawn_id;
    update public.world_boss_state set next_spawn_at = now() + (interval '1 hour' * (1 + random() * 5)) where id = 1;

    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- 3. status = 'ended': gap in progress, or gap just elapsed.
  if v_next_spawn_at is null or now() < v_next_spawn_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  -- Gap elapsed: pick the next boss (never the one that just ended), derive
  -- its stats from its home zone's top level, and roll the spawn.
  -- max_hp: same exponential-curve shape as goldReward(level) in
  -- zoneData.ts/resolve-combat, anchored 2,000 HP at level ~1 up to 50,000 HP
  -- at level 129 (matches the old flat figure at the endgame end).
  -- physical_defense/magic_defense: base_defense mirrors monsterDefense's own
  -- base (level * 1.5); the specialty side gets a 3.5x multiplier, the other
  -- side 1.3x. All four constants (2000/50000/3.5/1.3) are placeholders
  -- pending a real balance pass, same disclosed status the old flat
  -- max_hp=50000/BOSS_DEFENSE=200 numbers had.
  select boss_id, zone_top_level, defense_profile
  into v_boss_id, v_zone_top_level, v_defense_profile
  from public.zone_boss_catalog()
  where boss_id <> coalesce(v_last_boss_id, '')
  order by random()
  limit 1;

  v_max_hp := round(2000 * power(50000.0 / 2000.0, (v_zone_top_level - 1) / 129.0))::bigint;
  v_base_defense := round(v_zone_top_level * 1.5)::integer;
  if v_defense_profile = 'physical' then
    v_physical_defense := round(v_base_defense * 3.5)::integer;
    v_magic_defense := round(v_base_defense * 1.3)::integer;
  else
    v_magic_defense := round(v_base_defense * 3.5)::integer;
    v_physical_defense := round(v_base_defense * 1.3)::integer;
  end if;

  insert into public.world_boss_spawns
    (boss_id, max_hp, current_hp, physical_defense, magic_defense, window_started_at, window_ends_at)
  values
    (v_boss_id, v_max_hp, v_max_hp, v_physical_defense, v_magic_defense, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_new_spawn_id;

  update public.world_boss_state
  set current_spawn_id = v_new_spawn_id, next_spawn_at = null, last_boss_id = v_boss_id
  where id = 1;

  return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_new_spawn_id));
end;
$$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;
grant execute on function public.ensure_world_boss_spawn() to service_role;

-- ============================================================================
-- 5. apply_world_boss_attack — full body from 20261011000000's version, with
--    the same boss-name-aware reward-mail copy change as above applied to
--    its killing-blow payout branch. Damage itself is unchanged: it still
--    just accepts one pre-summed p_damage integer — the physical/magic split
--    happens Edge-Function-side, before this is ever called.
-- ============================================================================
create or replace function public.apply_world_boss_attack(p_character_id uuid, p_spawn_id uuid, p_damage integer)
returns jsonb
language plpgsql
as $$
declare
  v_current_spawn_id uuid;
  v_account_id uuid;
  v_participant_id uuid;
  v_free_used integer;
  v_paid_used integer;
  v_last_attempt_at timestamptz;
  v_status text;
  v_window_ends_at timestamptz;
  v_current_hp bigint;
  v_max_hp bigint;
  v_new_hp bigint;
  v_boss_id text;
  v_boss_display_name text;
  v_effective_damage integer;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_cooldown_ends_at timestamptz;
  v_batch_id uuid;
  v_reward_participant record;
  v_reward record;
  v_message text;
  v_top5_text text;
begin
  -- Lazy lifecycle trigger — guarantees the spawn this call validates
  -- against is current before anything else runs.
  perform public.ensure_world_boss_spawn();

  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1;
  if v_current_spawn_id <> p_spawn_id then
    return jsonb_build_object('ok', false, 'error', 'spawn_changed');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.world_boss_participants (spawn_id, character_id)
  values (p_spawn_id, p_character_id)
  on conflict (spawn_id, character_id) do nothing;

  select id, free_attempts_used, paid_attempts_used, last_attempt_at
  into v_participant_id, v_free_used, v_paid_used, v_last_attempt_at
  from public.world_boss_participants
  where spawn_id = p_spawn_id and character_id = p_character_id
  for update;

  select status, window_ends_at, current_hp, max_hp, boss_id
  into v_status, v_window_ends_at, v_current_hp, v_max_hp, v_boss_id
  from public.world_boss_spawns where id = p_spawn_id
  for update;

  if v_status <> 'active' or now() >= v_window_ends_at then
    return jsonb_build_object('ok', false, 'error', 'window_ended');
  end if;

  if v_current_hp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'boss_defeated');
  end if;

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '5 minutes' then
    return jsonb_build_object(
      'ok', false, 'error', 'on_cooldown', 'cooldown_ends_at', v_last_attempt_at + interval '5 minutes'
    );
  end if;

  if v_free_used < 10 then
    v_payment := 'free';
  elsif v_paid_used < 10 then
    v_payment := 'paid';
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 2 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ap');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'no_attempts_remaining');
  end if;

  if v_payment = 'paid' then
    update public.players set ascension_points = ascension_points - 2 where id = v_account_id
    returning ascension_points into v_new_ap;
  end if;

  -- Never tally/report more than what actually took the boss's HP down —
  -- overkill on the killing blow contributes nothing further.
  v_effective_damage := least(p_damage, v_current_hp);
  v_new_hp := greatest(v_current_hp - p_damage, 0);

  update public.world_boss_participants
  set
    free_attempts_used = free_attempts_used + case when v_payment = 'free' then 1 else 0 end,
    paid_attempts_used = paid_attempts_used + case when v_payment = 'paid' then 1 else 0 end,
    total_damage = total_damage + v_effective_damage,
    last_attempt_at = now()
  where id = v_participant_id
  returning free_attempts_used, paid_attempts_used into v_free_used, v_paid_used;

  update public.world_boss_spawns
  set current_hp = v_new_hp
  where id = p_spawn_id;

  -- Killing blow: pay rewards out now instead of waiting for
  -- ensure_world_boss_spawn to notice the window expired. world_boss_spawns
  -- was locked above, and the earlier current_hp <= 0 check already refused
  -- this call unless current_hp was still > 0, so this branch runs exactly
  -- once per spawn.
  if v_new_hp <= 0 then
    v_batch_id := gen_random_uuid();

    select display_name into v_boss_display_name from public.zone_boss_catalog() where boss_id = v_boss_id;
    v_boss_display_name := coalesce(v_boss_display_name, 'Zone Boss');

    select 'Top 5:' || E'\n' || coalesce(string_agg(
      format('%s. %s — %s damage', ranked.rn, ranked.character_name, to_char(ranked.total_damage, 'FM999,999,999,999')),
      E'\n' order by ranked.rn
    ), '(no participants)')
    into v_top5_text
    from (
      select row_number() over (order by wbp.total_damage desc) as rn, c.name as character_name, wbp.total_damage
      from public.world_boss_participants wbp
      join public.characters c on c.id = wbp.character_id
      where wbp.spawn_id = p_spawn_id and (wbp.free_attempts_used + wbp.paid_attempts_used) > 0
      order by wbp.total_damage desc
      limit 5
    ) ranked;

    for v_reward_participant in
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = p_spawn_id and (free_attempts_used + paid_attempts_used) > 0
    loop
      v_message := (case v_reward_participant.rn
        when 1 then 'You placed 1st in the ' || v_boss_display_name || ' fight!'
        when 2 then 'You placed 2nd in the ' || v_boss_display_name || ' fight!'
        when 3 then 'You placed 3rd in the ' || v_boss_display_name || ' fight!'
        else 'Thanks for fighting ' || v_boss_display_name || '!'
      end) || E'\n\n' || v_top5_text;

      for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
      end loop;

      if v_reward_participant.rn <= 3 then
        for v_reward in
          select * from public.world_boss_reward_for_tier(
            case v_reward_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_reward_participant.character_id, v_reward.currency_type, v_reward.amount, 'zone_boss_reward', v_batch_id, v_boss_display_name, 'Zone Boss Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.world_boss_spawns set rewards_distributed_at = now() where id = p_spawn_id;
  end if;

  v_cooldown_ends_at := now() + interval '5 minutes';

  return jsonb_build_object(
    'ok', true,
    'damage', v_effective_damage,
    'boss_current_hp', v_new_hp,
    'boss_max_hp', v_max_hp,
    'boss_defeated', v_new_hp <= 0,
    'free_attempts_used', v_free_used,
    'paid_attempts_used', v_paid_used,
    'ascension_points', v_new_ap,
    'cooldown_ends_at', v_cooldown_ends_at,
    'window_ends_at', v_window_ends_at,
    'payment', v_payment
  );
end;
$$;

revoke all on function public.apply_world_boss_attack(uuid, uuid, integer) from public;
grant execute on function public.apply_world_boss_attack(uuid, uuid, integer) to service_role;

commit;
