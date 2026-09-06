-- Daily Quests reset was anchored to UTC midnight (see CLAUDE.daily-quests.md),
-- which lands ~10am for a GMT+10 player (Queensland, no DST) rather than their
-- own local midnight -- reported as "quests didn't reset" when checked well
-- before the UTC rollover. Reworked to a fixed GMT+10 offset instead: the
-- reset boundary is now local midnight, computed as
-- ((now() at time zone 'utc') + interval '10 hours')::date. Fixed offset, not
-- per-player timezone -- there's nowhere today's schema stores a player's
-- timezone, and GMT+10 with no DST was the one requested. Full latest bodies
-- of roll_daily_quests/ensure_daily_quests_state from 20260906042235_daily_quests.sql,
-- only the reset-date expression changed -- same "create or replace of the
-- existing function's full body" convention as the 4 hook points in
-- CLAUDE.daily-quests.md.

create or replace function public.roll_daily_quests(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_types text[];
  v_level integer;
  v_quests jsonb := '[]'::jsonb;
  v_slot_type text;
  v_monster_id text;
  v_required_kills integer;
  i integer;
begin
  select level into v_level from public.characters where id = p_character_id;

  select array_agg(t) into v_types from (
    select t from unnest(array['quality_order', 'kill_count', 'world_boss_attacks', 'gold_donation', 'socket_obtain']) as t
    order by random() limit 3
  ) s;

  for i in 1..3 loop
    if v_types[i] = 'quality_order' then
      v_slot_type := (array['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat', 'quiver'])[1 + floor(random() * 7)::int];
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'quality_order', 'target', jsonb_build_object('slot_type', v_slot_type),
        'progress', 0, 'claimed', false));
    elsif v_types[i] = 'kill_count' then
      select id into v_monster_id from public.enemy_types where level <= v_level order by random() limit 1;
      v_required_kills := 100 + floor(random() * 901)::int;
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'kill_count',
        'target', jsonb_build_object('monster_id', v_monster_id, 'required_kills', v_required_kills),
        'progress', 0, 'claimed', false));
    elsif v_types[i] = 'world_boss_attacks' then
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', 'world_boss_attacks', 'target', jsonb_build_object('required_attacks', 5),
        'progress', 0, 'claimed', false));
    else
      v_quests := v_quests || jsonb_build_array(jsonb_build_object(
        'slot', i - 1, 'type', v_types[i], 'target', '{}'::jsonb, 'progress', 0, 'claimed', false));
    end if;
  end loop;

  insert into public.character_daily_quests (character_id, reset_date, quests, updated_at)
  values (p_character_id, ((now() at time zone 'utc') + interval '10 hours')::date, v_quests, now())
  on conflict (character_id) do update
    set reset_date = excluded.reset_date, quests = excluded.quests, updated_at = now();

  return v_quests;
end;
$$;

create or replace function public.ensure_daily_quests_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_reset_date date;
  v_quests jsonb;
begin
  select reset_date, quests into v_reset_date, v_quests
  from public.character_daily_quests where character_id = p_character_id for update;

  if not found or v_reset_date <> ((now() at time zone 'utc') + interval '10 hours')::date then
    v_quests := public.roll_daily_quests(p_character_id);
  end if;

  return v_quests;
end;
$$;
