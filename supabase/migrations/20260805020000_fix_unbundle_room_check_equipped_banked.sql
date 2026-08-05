-- Fixes a real bug reported by the user with a screenshot: "Why does it say
-- I don't have any inventory space to open one of my comet scrolls when I
-- quite clearly have 10?" — Inventory showed 30/40 (10 free, exactly the
-- documented "requires 10 free Inventory slots" threshold), yet
-- unbundle_currency_scroll rejected it with 'not_enough_room'.
--
-- Root cause: v_gear_count counted every item_instances row the character
-- owns via a plain `where owner_id = character_id`, with no exclusion for
-- equipped gear or Bank-Storage gear — both of which the client's own
-- occupied-slot formula (useInventoryStore.occupiedSlotCount) correctly
-- excludes, since an equipped item is shown only on the paper doll and a
-- banked item only in Bank Storage, neither counting against the 40-slot
-- Inventory cap. Any player with equipped gear at all (i.e. basically every
-- player) had their true Inventory occupancy overstated by however many
-- slots they had equipped/banked, causing this check to reject unbundles
-- the client's own displayed count said should succeed.
--
-- Fixed by excluding both — location <> 'bank', and id not among any of the
-- character's 7 equipped_*_id columns (built as an array via array_remove
-- to drop the nulls, then `id = any(...)`) — matching the client's own
-- formula exactly. Deliberately not touching the "+10" threshold itself
-- (unbundling frees the 1 scroll slot it consumes, so a stricter reading
-- would only need 9 truly free slots) — "requires 10 free Inventory slots"
-- is the confirmed, documented design (see CLAUDE.md), not something to
-- second-guess here; this migration only restores that promise being kept
-- honestly, since the actual bug is the miscounted "10."
create or replace function public.unbundle_currency_scroll(character_id uuid, currency_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_scroll_count integer;
  v_unit_count integer;
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
  v_occupied integer;
begin
  if currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id,
         comet_count, fallen_star_count,
         comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count, v_equipped_ids
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_scroll_count := case when currency_type = 'comet' then v_comet_scroll_count else v_fallen_star_scroll_count end;

  if v_scroll_count < 1 then
    return jsonb_build_object('ok', false, 'error', 'no_scrolls');
  end if;

  -- Excludes equipped and Bank-Storage gear (see this migration's own
  -- comment) — matches useInventoryStore.occupiedSlotCount's client-side
  -- formula, which was already the stated intent but not what this query
  -- actually did.
  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = character_id
    and location <> 'bank'
    and not (id = any(v_equipped_ids));

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = character_id;

  -- Qualified against the function's own parameter name (potion_stacks has its
  -- own character_id column, which would otherwise be ambiguous against this
  -- function's identically-named parameter).
  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = unbundle_currency_scroll.character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count
    + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

  if v_occupied + 10 > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room', 'occupied', v_occupied);
  end if;

  if currency_type = 'comet' then
    update public.characters
    set comet_count = comet_count + 10, comet_scroll_count = comet_scroll_count - 1
    where id = character_id
    returning comet_count, comet_scroll_count into v_unit_count, v_scroll_count;
  else
    update public.characters
    set fallen_star_count = fallen_star_count + 10, fallen_star_scroll_count = fallen_star_scroll_count - 1
    where id = character_id
    returning fallen_star_count, fallen_star_scroll_count into v_unit_count, v_scroll_count;
  end if;

  return jsonb_build_object('ok', true, 'currency_type', currency_type, 'unit_count', v_unit_count, 'scroll_count', v_scroll_count);
end;
$$;
