-- Fixes ensure_loose_currency's room check, which was overly conservative
-- and could wrongly refuse a genuinely-affordable Forge action (reported by
-- the user: paying an exact 28-Comet cost with 2 Comet Scrolls + 8 loose
-- was refused with 'not_enough_room_to_unbundle').
--
-- Root cause: the check compared `v_occupied + v_scrolls_needed * 10` against
-- the 40-slot cap, treating the full unbundled amount as if it would sit in
-- Inventory permanently. It never does — every one of this helper's four
-- callers (quality_upgrade/level_upgrade/master_forge_upgrade/
-- unlock_weapon_socket) immediately spends exactly p_amount_needed right
-- after this function returns. So the true final state is: v_scrolls_needed
-- Scroll tiles are freed, and only the small leftover "change"
-- (v_loose + 10*v_scrolls_needed - p_amount_needed, always 0-9, since
-- v_scrolls_needed is the minimal count covering the shortfall) persists as
-- new loose tiles. Net tile delta = 9*v_scrolls_needed - p_amount_needed,
-- which is frequently negative (unbundling to pay off an exact or
-- near-exact cost usually *frees* slots, since Scroll tiles collapse down to
-- however few loose units are left over) and is never larger than the old
-- formula's v_scrolls_needed*10, so this is strictly less restrictive than
-- before — it can only allow attempts the old check wrongly blocked, never
-- block ones it used to allow.
--
-- Signature is unchanged, so plain create-or-replace is safe (no overload
-- risk).
create or replace function public.ensure_loose_currency(
  p_character_id uuid,
  p_currency_type text,
  p_amount_needed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loose integer;
  v_scrolls integer;
  v_scrolls_needed integer;
  v_equipped_ids uuid[];
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_occupied integer;
begin
  if p_currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_loose := case when p_currency_type = 'comet' then v_comet_count else v_fallen_star_count end;
  v_scrolls := case when p_currency_type = 'comet' then v_comet_scroll_count else v_fallen_star_scroll_count end;

  if v_loose >= p_amount_needed then
    return jsonb_build_object('ok', true, 'unbundled', 0);
  end if;

  v_scrolls_needed := ceil((p_amount_needed - v_loose) / 10.0)::integer;

  if v_scrolls < v_scrolls_needed then
    -- Not enough even after unbundling everything owned — let the caller's
    -- own existing affordability check produce the familiar
    -- not_enough_comets/not_enough_fallen_stars error, nothing to unbundle.
    return jsonb_build_object('ok', true, 'unbundled', 0);
  end if;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids));

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = p_character_id;

  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = p_character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count
    + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

  -- Net tile delta after the whole operation completes (unbundle here, then
  -- the caller's own immediate `- p_amount_needed` spend) — see the header
  -- comment for the derivation. Only ever checks room for what will actually
  -- remain, not the full intermediate unbundle amount.
  if v_occupied + (9 * v_scrolls_needed - p_amount_needed) > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room', 'occupied', v_occupied);
  end if;

  if p_currency_type = 'comet' then
    update public.characters
    set comet_count = comet_count + v_scrolls_needed * 10,
        comet_scroll_count = comet_scroll_count - v_scrolls_needed
    where id = p_character_id;
  else
    update public.characters
    set fallen_star_count = fallen_star_count + v_scrolls_needed * 10,
        fallen_star_scroll_count = fallen_star_scroll_count - v_scrolls_needed
    where id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'unbundled', v_scrolls_needed);
end;
$$;
