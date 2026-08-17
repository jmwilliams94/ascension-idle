-- Row Combat: block toggling a slot OFF while it's mid-respawn (2026-08-17,
-- requested by the user). Without this, a player could toggle a dead/
-- respawning slot off (clearing it outright) then immediately back on
-- (which rolls a fresh full-HP spawn instantly) — completely skipping the
-- 10s ROW_RESPAWN_MS wait. Turning a slot off while it's still ALIVE is
-- unaffected (no timer being bypassed there, just discarding your own
-- already-dealt damage — no benefit to the player). Client mirrors this as
-- a disabled button during the respawn countdown (RowCombatPanel.tsx), but
-- this is the real authority.
begin;

create or replace function public.toggle_row_slot(p_character_id uuid, p_slot_index smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_selected_monster_id text;
  v_row1_unlocked boolean;
  v_row2_unlocked boolean;
  v_row_slots jsonb;
  v_slot jsonb;
  v_new_slot jsonb;
  v_monster_level integer;
  v_monster_max_hp integer;
  v_is_rare boolean;
  v_hp integer;
begin
  if p_slot_index < 0 or p_slot_index > 11 then
    return jsonb_build_object('ok', false, 'error', 'invalid_slot');
  end if;

  select account_id, selected_monster_id, row1_unlocked, row2_unlocked, row_slots
  into v_account_id, v_selected_monster_id, v_row1_unlocked, v_row2_unlocked, v_row_slots
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if (p_slot_index < 6 and not v_row1_unlocked) or (p_slot_index >= 6 and not v_row2_unlocked) then
    return jsonb_build_object('ok', false, 'error', 'row_locked');
  end if;

  -- row_slots may still be the '[]' default before this character's first
  -- ever toggle — pad it out to 12 empty slots on first use.
  if v_row_slots is null or jsonb_array_length(v_row_slots) < 12 then
    v_row_slots := (
      select coalesce(jsonb_agg(coalesce(v_row_slots -> g.i, jsonb_build_object(
        'enabled', false, 'monster_id', null, 'current_hp', 0, 'max_hp', 0, 'is_rare', false, 'dead_at', null
      ))), '[]'::jsonb)
      from generate_series(0, 11) as g(i)
    );
  end if;

  v_slot := v_row_slots -> p_slot_index;

  if coalesce((v_slot ->> 'enabled')::boolean, false) then
    if v_slot ->> 'dead_at' is not null then
      return jsonb_build_object('ok', false, 'error', 'respawning');
    end if;
    -- Turning off — clear outright, no partial credit.
    v_new_slot := jsonb_build_object(
      'enabled', false, 'monster_id', null, 'current_hp', 0, 'max_hp', 0, 'is_rare', false, 'dead_at', null
    );
  else
    if v_selected_monster_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_monster_selected');
    end if;

    select level, max_hp into v_monster_level, v_monster_max_hp
    from public.enemy_types
    where id = v_selected_monster_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'unknown_monster');
    end if;

    -- Mirrors combatResolver.ts's rollIsRare/spawnMonsterHp exactly.
    v_is_rare := random() < 0.05;
    v_hp := case when v_is_rare then round(v_monster_max_hp * 2) else v_monster_max_hp end;

    v_new_slot := jsonb_build_object(
      'enabled', true,
      'monster_id', v_selected_monster_id,
      'current_hp', v_hp,
      'max_hp', v_hp,
      'is_rare', v_is_rare,
      'dead_at', null
    );
  end if;

  v_row_slots := jsonb_set(v_row_slots, array[p_slot_index::text], v_new_slot);

  update public.characters set row_slots = v_row_slots where id = p_character_id;

  return jsonb_build_object('ok', true, 'row_slots', v_row_slots);
end;
$$;

revoke all on function public.toggle_row_slot(uuid, smallint) from public;
grant execute on function public.toggle_row_slot(uuid, smallint) to authenticated;

commit;
