-- Row Combat: clear all 12 row slots at once (2026-08-17, requested by the
-- user — "anytime you switch enemies, the rows are reset/cleared"). Called
-- from CombatPage.tsx whenever the player commits to fighting a different
-- monster (the Fight button) or switches zones, so Row Combat never keeps
-- fighting a monster type left over from a target the player has since
-- moved on from. Mirrors toggle_row_slot's own ownership-check shape, just
-- bulk instead of one slot at a time.
begin;

create or replace function public.clear_row_slots(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_empty_slots jsonb;
begin
  select account_id into v_account_id
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select jsonb_agg(jsonb_build_object(
    'enabled', false, 'monster_id', null, 'current_hp', 0, 'max_hp', 0, 'is_rare', false, 'dead_at', null
  ))
  into v_empty_slots
  from generate_series(0, 11);

  update public.characters set row_slots = v_empty_slots where id = p_character_id;

  return jsonb_build_object('ok', true, 'row_slots', v_empty_slots);
end;
$$;

revoke all on function public.clear_row_slots(uuid) from public;
grant execute on function public.clear_row_slots(uuid) to authenticated;

commit;
