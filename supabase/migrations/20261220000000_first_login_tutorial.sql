-- First-login tutorial (admin-only for now, repeatable while testing -- see
-- the v_repeatable flag in grant_tutorial_starter_kit). Walks a brand new
-- character through: a free Lucky Lad roll (guaranteed Experience Potion), a
-- guaranteed weapon Level Upgrade (which also unlocks socket 1 for free,
-- bundled into the same call -- weapon sockets are normally their own
-- separate paid unlock_weapon_socket call), a guaranteed Quality Upgrade,
-- and socketing the granted Iris gem (via the real, already-deterministic
-- socket_gem -- no change needed there). None of the four RPCs below insert
-- into global_announcements -- these are repeated admin/test actions, not
-- real player milestones.
begin;

alter table public.players add column tutorial_completed_at timestamptz;

-- ============================================================================
-- 1. grant_tutorial_starter_kit -- admin-only. Grants 1 normal Iris gem + 1
--    Comet + 1 Fallen Star, each spent exactly once by the guided flow
--    itself (tutorial_level_upgrade/tutorial_quality_upgrade/socket_gem
--    below) -- nothing left over afterward.
-- ============================================================================
create or replace function public.grant_tutorial_starter_kit(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  -- TODO: flip to false once the tutorial ships to real players --
  -- players.tutorial_completed_at then becomes a real one-time account-wide
  -- gate (closing the character-delete-and-recreate farm CLAUDE.md warns
  -- about) instead of a no-op stamp.
  v_repeatable constant boolean := true;
  v_already_completed timestamptz;
  v_gems jsonb;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select tutorial_completed_at into v_already_completed from public.players where id = v_account_id for update;
  if not v_repeatable and v_already_completed is not null then
    return jsonb_build_object('ok', false, 'error', 'already_granted');
  end if;

  select gems into v_gems from public.characters where id = p_character_id for update;
  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array['iris_normal'], to_jsonb(coalesce((v_gems ->> 'iris_normal')::integer, 0) + 1));

  update public.characters
  set gems = v_gems, comet_count = comet_count + 1, fallen_star_count = fallen_star_count + 1
  where id = p_character_id;

  update public.players set tutorial_completed_at = now() where id = v_account_id;

  return jsonb_build_object('ok', true, 'gems', v_gems);
end;
$$;

revoke all on function public.grant_tutorial_starter_kit(uuid) from public;
grant execute on function public.grant_tutorial_starter_kit(uuid) to authenticated;

-- ============================================================================
-- 2. tutorial_level_upgrade -- admin-only. Deterministic clone of
--    level_upgrade's success path (no random() roll) -- see
--    20260922000000_restore_weapon_120_master_forge_only.sql -- plus a free,
--    bundled weapon socket-1 unlock (mirrors unlock_weapon_socket's core,
--    see 20260930050000_block_pickaxe_sockets.sql, but with no extra Fallen
--    Star cost). Same real cost as level_upgrade (1 Comet).
-- ============================================================================
create or replace function public.tutorial_level_upgrade(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_item_family text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_comets integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select owner_id, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_template_id, v_sockets
  from public.item_instances
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, comet_count into v_account_id, v_comets
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_comets < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_comets');
  end if;

  select item_family, required_level, slot_type into v_item_family, v_required_level, v_slot_type
  from public.item_templates
  where id = v_template_id;

  if v_item_family is null then
    return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
  end if;

  select id, required_level into v_next_template_id, v_next_required_level
  from public.item_templates
  where item_family = v_item_family and required_level > v_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_level');
  end if;

  update public.characters set comet_count = comet_count - 1 where id = v_character_id
  returning comet_count into v_comets;

  update public.item_instances
  set template_id = v_next_template_id, level = v_next_required_level
  where id = p_item_id;

  if v_slot_type = 'weapon' and jsonb_array_length(v_sockets) = 0 then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = p_item_id
    returning sockets into v_sockets;
  end if;

  return jsonb_build_object(
    'ok', true,
    'level', v_next_required_level,
    'template_id', v_next_template_id,
    'comets_remaining', v_comets,
    'sockets', v_sockets
  );
end;
$$;

revoke all on function public.tutorial_level_upgrade(uuid) from public;
grant execute on function public.tutorial_level_upgrade(uuid) to authenticated;

-- ============================================================================
-- 3. tutorial_quality_upgrade -- admin-only. Deterministic clone of
--    quality_upgrade's success path (see
--    20260930070000_block_pickaxe_quality_upgrade.sql). Same real cost as
--    quality_upgrade (1 Fallen Star). No socket-roll logic needed -- the
--    weapon's socket 1 was already unlocked by tutorial_level_upgrade above.
-- ============================================================================
create or replace function public.tutorial_quality_upgrade(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_fallen_stars integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select owner_id, quality_tier into v_character_id, v_current_tier
  from public.item_instances
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_count into v_account_id, v_fallen_stars
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_fallen_stars < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars');
  end if;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality');
  end if;

  update public.characters set fallen_star_count = fallen_star_count - 1 where id = v_character_id
  returning fallen_star_count into v_fallen_stars;

  update public.item_instances set quality_tier = v_next_tier where id = p_item_id;

  return jsonb_build_object('ok', true, 'quality_tier', v_next_tier, 'fallen_stars_remaining', v_fallen_stars);
end;
$$;

revoke all on function public.tutorial_quality_upgrade(uuid) from public;
grant execute on function public.tutorial_quality_upgrade(uuid) to authenticated;

-- ============================================================================
-- 4. tutorial_draw_lucky_ticket -- admin-only. Near-duplicate of
--    draw_lucky_ticket's free-ticket path (same 9-card board via
--    pick_lucky_reward, same real 4h cooldown consumption -- see
--    20261206000000_experience_orb_and_potion.sql), but the picked card is
--    force-overwritten to a guaranteed Experience Potion regardless of which
--    of the 9 chests the player taps.
-- ============================================================================
create or replace function public.tutorial_draw_lucky_ticket(p_character_id uuid, p_card_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_board jsonb := '[]'::jsonb;
  v_experience_potion_count integer;
  i integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id for update;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- Row-locked for symmetry with draw_lucky_ticket, even though this
  -- function doesn't branch on the existing value -- it always claims the
  -- free ticket.
  perform 1 from public.players where id = v_account_id for update;

  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_board := jsonb_set(v_board, array[p_card_index::text], jsonb_build_object('kind', 'experience_potion', 'amount', 1));

  update public.players set lucky_free_ticket_claimed_at = now() where id = v_account_id;

  update public.characters set experience_potion_count = experience_potion_count + 1 where id = p_character_id
  returning experience_potion_count into v_experience_potion_count;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'won_index', p_card_index,
    'experience_potion_count', v_experience_potion_count,
    'next_free_ticket_at', now() + interval '4 hours'
  );
end;
$$;

revoke all on function public.tutorial_draw_lucky_ticket(uuid, integer) from public;
grant execute on function public.tutorial_draw_lucky_ticket(uuid, integer) to authenticated;

commit;
