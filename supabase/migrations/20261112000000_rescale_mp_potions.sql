begin;

-- MP potion healAmount ladder was badly under-scaled relative to real MP
-- pools (e.g. a level-50 Wuxia sitting around 500 max MP, but the top-tier
-- level-125 potion only restored 130) — rescaled client-side in
-- src/game/items/potionTypes.ts, mirrored here. Same signature as before, so
-- create or replace is sufficient (no arg-list change).
create or replace function public.use_potion_stack(p_stack_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_character_id uuid;
  v_account_id uuid;
  v_count integer;
  v_new_count integer;
  v_potion_type text;
  v_restore_amount numeric;
begin
  select character_id, count, potion_type into v_owner_character_id, v_count, v_potion_type
  from public.potion_stacks
  where id = p_stack_id
  for update;

  if not found or v_owner_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  update public.potion_stacks set count = count - 1 where id = p_stack_id
  returning count into v_new_count;

  -- Mirrors src/game/items/potionTypes.ts's MP-tier healAmount values — keep
  -- in sync. Only credited when current_mp is already a real (non-null)
  -- value — a null column means "presumed full" (see resolve-combat's own
  -- lazy-init read), and a potion used while already full is correctly a
  -- no-op, same as the client's own clamp-to-max restorePlayerMp.
  v_restore_amount := case v_potion_type
    when 'mossglow_tonic' then 75
    when 'whisperleaf_draught' then 140
    when 'moonpetal_elixir' then 200
    when 'starlight_brew' then 350
    when 'emberwind_panacea' then 500
    when 'nightbloom_draught' then 750
    when 'voidglass_elixir' then 1000
    when 'astral_draught' then 1500
    else null
  end;

  if v_restore_amount is not null then
    update public.characters
    set current_mp = current_mp + v_restore_amount
    where id = p_character_id and current_mp is not null;
  end if;

  return jsonb_build_object('ok', true, 'count', v_new_count);
end;
$$;

revoke all on function public.use_potion_stack(uuid, uuid) from public;
grant execute on function public.use_potion_stack(uuid, uuid) to authenticated;

commit;
