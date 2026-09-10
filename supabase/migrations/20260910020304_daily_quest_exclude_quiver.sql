-- quality_order quests could roll 'quiver' as the target slot_type, but
-- Quiver is not an obtainable item -- it's granted exactly once at Hunter
-- character creation (grant_starter_items, 20260821000000) with no Shop
-- listing (removed 2026-08-14) and no monster-drop path
-- (pick_drop_template excludes item_family 'quiver'). Turning in a
-- character's one Quiver would also strand it unable to attack (Quiver
-- required to fight), and it could never be replaced. Same class of problem
-- pickaxe was already excluded for (never reaches Tempered+) -- quiver is
-- excluded for a different reason (can't be re-acquired at all), same fix:
-- drop it from the roll pool. Full latest body from
-- 20261217000000_daily_quests_local_midnight_reset.sql, only the slot_type
-- array changed.
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
      v_slot_type := (array['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat'])[1 + floor(random() * 6)::int];
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
