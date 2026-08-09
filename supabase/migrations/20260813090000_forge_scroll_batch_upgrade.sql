-- Forge: Scroll batch upgrade (2026-08-13, requested by the user). Dropping a
-- Comet Scroll / Fallen Star Scroll onto the Standard Forge's Material slot
-- (instead of a loose Comet/Fallen Star) fires up to 10 chained Level/Quality
-- Upgrade attempts in one atomic call, each re-evaluating success chance off
-- whatever the item's *current* state is (so a successful roll 1 feeds into
-- roll 2's calculation). No per-roll UI -- only the net before/after result
-- is shown. The Scroll is consumed up front and never refunded, even if the
-- item maxes out partway through and the remaining rolls go unused (mirrors
-- every other Forge cost's "spent regardless of outcome" rule). The ~1%
-- armor-socket-unlock side roll still fires per attempt, but -- unlike the
-- single-attempt level_upgrade/quality_upgrade, which roll it on every
-- attempt regardless of outcome -- here it only rolls on rolls that actually
-- succeeded (confirmed with the user). Bodies are loop-ified copies of
-- level_upgrade (20260810030000_fix_socket_announcement_stale_name.sql) and
-- quality_upgrade (20260808050000_global_announcements.sql) -- keep the
-- shared bits (compute_upgrade_success_chance_pct call, next-template-in-
-- chain query, quality-tier case, socket roll block) in sync with those if
-- they ever change.

create or replace function public.level_upgrade_scroll(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_current_level integer;
  v_quality_tier text;
  v_template_id uuid;
  v_item_family text;
  v_item_name text;
  v_slot_type text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric := 0.01;
  v_comet_scrolls integer;
  v_success_chance numeric;
  v_upgraded boolean;
  v_rolls_attempted integer := 0;
  v_rolls_succeeded integer := 0;
  v_next_template_id uuid;
  v_next_required_level integer;
  i integer;
begin
  select owner_id, level, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_quality_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, comet_scroll_count, name into v_account_id, v_comet_scrolls, v_character_name
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_comet_scrolls < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_comet_scrolls');
  end if;

  select item_family, required_level, slot_type, name
  into v_item_family, v_required_level, v_slot_type, v_item_name
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
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  -- Spent up front, regardless of how many of the 10 rolls actually execute
  -- or succeed -- no partial refund for rolls left unused after the item
  -- tops out mid-batch.
  update public.characters set comet_scroll_count = comet_scroll_count - 1 where id = v_character_id
  returning comet_scroll_count into v_comet_scrolls;

  for i in 1..10 loop
    -- Re-resolve against the *current* chain position every iteration -- a
    -- prior successful iteration may have already advanced v_template_id/
    -- v_required_level.
    select id, required_level into v_next_template_id, v_next_required_level
    from public.item_templates
    where item_family = v_item_family and required_level > v_required_level
    order by required_level asc
    limit 1;

    exit when v_next_template_id is null; -- topped out; remaining rolls wasted, no refund

    v_rolls_attempted := v_rolls_attempted + 1;
    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;
    v_upgraded := random() < v_success_chance;

    if v_upgraded then
      v_rolls_succeeded := v_rolls_succeeded + 1;
      v_template_id := v_next_template_id;
      v_required_level := v_next_required_level;
      v_current_level := v_next_required_level;

      select name into v_item_name from public.item_templates where id = v_template_id;

      -- Socket roll only fires on a successful upgrade roll within the batch
      -- (deliberately different from level_upgrade's own every-attempt roll).
      v_socket_count := jsonb_array_length(v_sockets);
      if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
         and v_socket_count < 2
         and random() < v_socket_roll_chance then
        v_sockets := v_sockets || 'null'::jsonb;
        v_socket_gained := true;

        insert into public.global_announcements (kind, character_name, message)
        values (
          'armor_socket',
          v_character_name,
          v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained a socket!'
        );
      end if;
    end if;
  end loop;

  update public.item_instances
  set template_id = v_template_id, level = v_current_level, sockets = v_sockets
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_rolls_succeeded > 0,
    'rolls_attempted', v_rolls_attempted,
    'rolls_succeeded', v_rolls_succeeded,
    'level', v_current_level,
    'template_id', v_template_id,
    'comet_scrolls_remaining', v_comet_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

revoke all on function public.level_upgrade_scroll(uuid) from public;
grant execute on function public.level_upgrade_scroll(uuid) to authenticated;

create or replace function public.quality_upgrade_scroll(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_name text;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_item_family text;
  v_item_name text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_star_scrolls integer;
  v_success_chance numeric;
  v_upgraded boolean;
  v_rolls_attempted integer := 0;
  v_rolls_succeeded integer := 0;
  i integer;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_scroll_count, name into v_account_id, v_fallen_star_scrolls, v_character_name
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_fallen_star_scrolls < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_star_scrolls');
  end if;

  select slot_type, item_family, required_level, name
  into v_slot_type, v_item_family, v_required_level, v_item_name
  from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  update public.characters set fallen_star_scroll_count = fallen_star_scroll_count - 1 where id = v_character_id
  returning fallen_star_scroll_count into v_fallen_star_scrolls;

  for i in 1..10 loop
    v_next_tier := case v_current_tier
      when 'normal' then 'tempered'
      when 'tempered' then 'infused'
      when 'infused' then 'radiant'
      when 'radiant' then 'ascended'
      else null
    end;

    exit when v_next_tier is null; -- already ascended; remaining rolls wasted, no refund

    v_rolls_attempted := v_rolls_attempted + 1;
    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_current_tier, 'quality') / 100.0;
    v_upgraded := random() < v_success_chance;

    if v_upgraded then
      v_rolls_succeeded := v_rolls_succeeded + 1;
      v_current_tier := v_next_tier;

      v_socket_count := jsonb_array_length(v_sockets);
      if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
         and v_socket_count < 2
         and random() < v_socket_roll_chance then
        v_sockets := v_sockets || 'null'::jsonb;
        v_socket_gained := true;

        insert into public.global_announcements (kind, character_name, message)
        values (
          'armor_socket',
          v_character_name,
          v_character_name || '''s ' || coalesce(v_item_name, 'gear') || ' gained a socket!'
        );
      end if;
    end if;
  end loop;

  update public.item_instances
  set quality_tier = v_current_tier, sockets = v_sockets
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_rolls_succeeded > 0,
    'rolls_attempted', v_rolls_attempted,
    'rolls_succeeded', v_rolls_succeeded,
    'quality_tier', v_current_tier,
    'fallen_star_scrolls_remaining', v_fallen_star_scrolls,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

revoke all on function public.quality_upgrade_scroll(uuid) from public;
grant execute on function public.quality_upgrade_scroll(uuid) to authenticated;
