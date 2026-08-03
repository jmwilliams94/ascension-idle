-- Full internal rename: Meteor -> Comet, DragonBall -> Fallen Star (confirmed
-- with the user, 2026-08-03, alongside lowering the pet drop rate and adding
-- pet/DragonBall AFK notifications -- see CLAUDE.md). The user asked for a
-- genuine rename, not just new display text: every column, constraint,
-- RPC body, and stored data value that says "meteor"/"dragonball" changes to
-- "comet"/"fallen_star" in this migration. The matching TypeScript sweep
-- (identifiers, icons, asset files) lands in the same commit as this file.
--
-- Naming: dragonball -> fallen_star (snake_case)/fallenStar (camelCase),
-- meteor -> comet. transfer_currency's own `currency` parameter is unusually
-- PLURAL ('meteors'/'dragonballs', unlike every other function's singular
-- 'meteor'/'dragonball') -- preserved as plural ('comets'/'fallen_stars')
-- here rather than unified, to keep this diff scoped to renaming only.
--
-- Also drops the confirmed-dead grant_currency_reward function (unused by any
-- client call since resolve-combat took over currency-drop granting -- see
-- useCurrencyStore.ts's own comment about it) -- matches this project's
-- established "remove confirmed-dead code" precedent.
begin;

-- ============================================================================
-- 1. Column renames.
-- ============================================================================
alter table public.characters rename column meteor_count to comet_count;
alter table public.characters rename column dragonball_count to fallen_star_count;
alter table public.characters rename column meteor_scroll_count to comet_scroll_count;
alter table public.characters rename column dragonball_scroll_count to fallen_star_scroll_count;

alter table public.players rename column bank_meteors to bank_comets;
alter table public.players rename column bank_dragonballs to bank_fallen_stars;
alter table public.players rename column meteor_bank_count to comet_bank_count;
alter table public.players rename column dragonball_bank_count to fallen_star_bank_count;

-- ============================================================================
-- 2. Constraint renames -- fixing the already-stale characters_meteors_check/
--    characters_dragonballs_check names properly this time (they never got
--    renamed when their columns became meteor_count/dragonball_count).
-- ============================================================================
alter table public.characters rename constraint characters_meteors_check to characters_comets_check;
alter table public.characters rename constraint characters_dragonballs_check to characters_fallen_stars_check;
alter table public.characters rename constraint characters_meteor_scroll_count_check to characters_comet_scroll_count_check;
alter table public.characters rename constraint characters_dragonball_scroll_count_check to characters_fallen_star_scroll_count_check;

alter table public.players rename constraint players_bank_meteors_check to players_bank_comets_check;
alter table public.players rename constraint players_bank_dragonballs_check to players_bank_fallen_stars_check;
alter table public.players rename constraint players_meteor_bank_count_check to players_comet_bank_count_check;
alter table public.players rename constraint players_dragonball_bank_count_check to players_fallen_star_bank_count_check;

-- ============================================================================
-- 3. Data + constraint swap for the three tables storing raw currency_type
--    string values. Drop each CHECK first (old values wouldn't satisfy a
--    constraint already swapped to the new value set), update the data, then
--    add the new CHECK back.
-- ============================================================================
alter table public.loot_holding drop constraint if exists loot_holding_currency_type_check;
update public.loot_holding set currency_type = 'comet' where currency_type = 'meteor';
update public.loot_holding set currency_type = 'fallen_star' where currency_type = 'dragonball';
alter table public.loot_holding add constraint loot_holding_currency_type_check check (currency_type in ('comet', 'fallen_star'));

alter table public.marketplace_listings drop constraint if exists marketplace_listings_currency_type_check;
update public.marketplace_listings set currency_type = 'comet' where currency_type = 'meteor';
update public.marketplace_listings set currency_type = 'fallen_star' where currency_type = 'dragonball';
update public.marketplace_listings set currency_type = 'comet_scroll' where currency_type = 'meteor_scroll';
update public.marketplace_listings set currency_type = 'fallen_star_scroll' where currency_type = 'dragonball_scroll';
alter table public.marketplace_listings add constraint marketplace_listings_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll'));

alter table public.mail drop constraint if exists mail_currency_type_check;
update public.mail set currency_type = 'comet' where currency_type = 'meteor';
update public.mail set currency_type = 'fallen_star' where currency_type = 'dragonball';
update public.mail set currency_type = 'comet_scroll' where currency_type = 'meteor_scroll';
update public.mail set currency_type = 'fallen_star_scroll' where currency_type = 'dragonball_scroll';
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll'));

-- ============================================================================
-- 4. Drop the confirmed-dead grant_currency_reward function outright.
-- ============================================================================
drop function if exists public.grant_currency_reward(uuid, integer, integer);

-- ============================================================================
-- 5. unlock_weapon_socket
-- ============================================================================
create or replace function public.unlock_weapon_socket(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_slot_type text;
  v_sockets jsonb;
  v_socket_count integer;
  v_cost integer;
  v_fallen_stars integer;
begin
  select owner_id, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
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

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  if v_slot_type is distinct from 'weapon' then
    return jsonb_build_object('ok', false, 'error', 'not_a_weapon');
  end if;

  v_socket_count := jsonb_array_length(v_sockets);

  if v_socket_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'max_sockets', 'sockets', v_sockets);
  end if;

  v_cost := case v_socket_count when 0 then 1 else 5 end;

  if v_fallen_stars < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_fallen_stars',
      'cost', v_cost,
      'fallen_stars', v_fallen_stars
    );
  end if;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;

  update public.item_instances
  set sockets = v_sockets || 'null'::jsonb
  where id = item_id
  returning sockets into v_sockets;

  return jsonb_build_object(
    'ok', true,
    'sockets', v_sockets,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost
  );
end;
$$;

-- ============================================================================
-- 6. quality_upgrade -- Meteor/DragonBall rename only; quality-tier value
--    renaming (refined/unique/elite/super) is a separate migration.
-- ============================================================================
create or replace function public.quality_upgrade(item_id uuid)
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
  v_template_id uuid;
  v_slot_type text;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric := 0.7;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_stars integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
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

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'refined'
    when 'refined' then 'unique'
    when 'unique' then 'elite'
    when 'elite' then 'super'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  if v_fallen_stars < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_fallen_stars',
      'cost', v_cost,
      'fallen_stars', v_fallen_stars
    );
  end if;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 7. level_upgrade
-- ============================================================================
create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_level integer;
  v_template_id uuid;
  v_item_family text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric := 0.8;
  v_socket_roll_chance numeric := 0.01;
  v_comets integer;
  v_upgraded boolean;
begin
  select owner_id, level, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
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
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  if v_comets < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_comets',
      'cost', v_cost,
      'comets', v_comets
    );
  end if;

  update public.characters set comet_count = comet_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'comets_spent', v_cost,
    'comets_remaining', v_comets - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- 8. transfer_currency -- currency param stays plural ('comets'/
--    'fallen_stars'), matching the pre-existing 'meteors'/'dragonballs' split
--    from every other (singular) currency-type parameter in this codebase.
-- ============================================================================
create or replace function public.transfer_currency(character_id uuid, currency text, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_balance integer;
  v_bank_balance integer;
  v_scroll_count integer;
  v_scrolls_needed integer;
begin
  if currency not in ('gold', 'comets', 'fallen_stars') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  perform 1 from public.players where id = v_account_id for update;

  if currency = 'gold' then
    select gold into v_character_balance from public.characters where id = character_id;
    select bank_gold into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'comets' then
    select comet_count, comet_scroll_count into v_character_balance, v_scroll_count
    from public.characters where id = character_id;
    select bank_comets into v_bank_balance from public.players where id = v_account_id;
  else
    select fallen_star_count, fallen_star_scroll_count into v_character_balance, v_scroll_count
    from public.characters where id = character_id;
    select bank_fallen_stars into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if currency = 'gold' then
      if v_character_balance < amount then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;
      v_character_balance := v_character_balance - amount;
    else
      if amount > v_character_balance + v_scroll_count * 10 then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;

      v_scrolls_needed := greatest(0, ceil((amount - v_character_balance) / 10.0))::integer;
      v_scroll_count := v_scroll_count - v_scrolls_needed;
      v_character_balance := v_character_balance + v_scrolls_needed * 10 - amount;
    end if;
    v_bank_balance := v_bank_balance + amount;
  else
    if v_bank_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_balance := v_bank_balance - amount;
    v_character_balance := v_character_balance + amount;
  end if;

  if currency = 'gold' then
    update public.characters set gold = v_character_balance where id = character_id;
    update public.players set bank_gold = v_bank_balance where id = v_account_id;
  elsif currency = 'comets' then
    update public.characters
    set comet_count = v_character_balance, comet_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_comets = v_bank_balance where id = v_account_id;
  else
    update public.characters
    set fallen_star_count = v_character_balance, fallen_star_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_fallen_stars = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'character_balance', v_character_balance,
    'bank_balance', v_bank_balance,
    'character_scroll_count', v_scroll_count
  );
end;
$$;

-- ============================================================================
-- 9. claim_loot_holding
-- ============================================================================
create or replace function public.claim_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_currency_type text;
  v_required_level integer;
  v_item jsonb;
  v_new_count integer;
begin
  select character_id, template_id, quality_tier, currency_type
  into v_character_id, v_template_id, v_quality_tier, v_currency_type
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + 1 where id = v_character_id
      returning comet_count into v_new_count;
    else
      update public.characters set fallen_star_count = fallen_star_count + 1 where id = v_character_id
      returning fallen_star_count into v_new_count;
    end if;

    delete from public.loot_holding where id = holding_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  select required_level into v_required_level from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level)
  values (v_template_id, v_character_id, v_quality_tier, coalesce(v_required_level, 1))
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

-- ============================================================================
-- 10. bundle_currency_scroll / unbundle_currency_scroll
-- ============================================================================
create or replace function public.bundle_currency_scroll(character_id uuid, currency_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_unit_count integer;
  v_scroll_count integer;
begin
  if currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'comet' then
    select comet_count into v_unit_count from public.characters where id = character_id;
  else
    select fallen_star_count into v_unit_count from public.characters where id = character_id;
  end if;

  if v_unit_count < 10 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_units', 'owned', v_unit_count);
  end if;

  if currency_type = 'comet' then
    update public.characters
    set comet_count = comet_count - 10, comet_scroll_count = comet_scroll_count + 1
    where id = character_id
    returning comet_count, comet_scroll_count into v_unit_count, v_scroll_count;
  else
    update public.characters
    set fallen_star_count = fallen_star_count - 10, fallen_star_scroll_count = fallen_star_scroll_count + 1
    where id = character_id
    returning fallen_star_count, fallen_star_scroll_count into v_unit_count, v_scroll_count;
  end if;

  return jsonb_build_object('ok', true, 'currency_type', currency_type, 'unit_count', v_unit_count, 'scroll_count', v_scroll_count);
end;
$$;

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
  v_occupied integer;
begin
  if currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  select account_id,
         comet_count, fallen_star_count,
         comet_scroll_count, fallen_star_scroll_count
  into v_account_id, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count
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

  select count(*) into v_gear_count from public.item_instances where owner_id = character_id;

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

-- ============================================================================
-- 11. unlock_next_achievement_tier
-- ============================================================================
create or replace function public.unlock_next_achievement_tier(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_comets integer;
  v_fallen_stars integer;
  v_current_index integer;
  v_kills integer;
  v_next_index integer;
  v_currency text;
  v_cost integer;
  v_new_comets integer;
  v_new_fallen_stars integer;
begin
  select account_id, comet_count, fallen_star_count into v_account_id, v_comets, v_fallen_stars
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select unlocked_tier_index, kills into v_current_index, v_kills
  from public.character_monster_kills
  where character_id = p_character_id
    and monster_id = p_monster_id;

  v_current_index := coalesce(v_current_index, 0);
  v_kills := coalesce(v_kills, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  if v_kills < 100 then
    return jsonb_build_object('ok', false, 'error', 'kill_count_tier_required', 'kills', v_kills, 'kills_required', 100);
  end if;

  case v_next_index
    when 1 then v_currency := 'comet'; v_cost := 1;
    when 2 then v_currency := 'comet'; v_cost := 3;
    when 3 then v_currency := 'comet'; v_cost := 5;
    when 4 then v_currency := 'comet'; v_cost := 10;
    when 5 then v_currency := 'comet'; v_cost := 20;
    when 6 then v_currency := 'fallen_star'; v_cost := 1;
  end case;

  if v_currency = 'comet' then
    if v_comets < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_comets', 'cost', v_cost, 'currency', v_currency, 'comets', v_comets);
    end if;
    update public.characters set comet_count = comet_count - v_cost where id = p_character_id
    returning comet_count into v_new_comets;
    v_new_fallen_stars := v_fallen_stars;
  else
    if v_fallen_stars < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars', 'cost', v_cost, 'currency', v_currency, 'fallen_stars', v_fallen_stars);
    end if;
    update public.characters set fallen_star_count = fallen_star_count - v_cost where id = p_character_id
    returning fallen_star_count into v_new_fallen_stars;
    v_new_comets := v_comets;
  end if;

  insert into public.character_monster_kills (character_id, monster_id, kills, unlocked_tier_index)
  values (p_character_id, p_monster_id, 0, v_next_index)
  on conflict (character_id, monster_id)
  do update set unlocked_tier_index = v_next_index;

  return jsonb_build_object(
    'ok', true,
    'unlocked_tier_index', v_next_index,
    'currency', v_currency,
    'cost', v_cost,
    'comets_remaining', v_new_comets,
    'fallen_stars_remaining', v_new_fallen_stars
  );
end;
$$;

-- ============================================================================
-- 12. create_marketplace_listing
-- ============================================================================
create or replace function public.create_marketplace_listing(
  p_character_id uuid,
  p_item_id uuid,
  p_price_currency text,
  p_price_amount integer,
  p_duration_hours integer,
  p_currency_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_fee integer;
  v_balance integer;
  v_new_balance integer;
  v_listing_id uuid;
  v_active_listing_count integer;
  v_unit_count integer;
begin
  if p_price_currency not in ('gold', 'ascension_points') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;
  if p_price_amount is null or p_price_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;
  if p_duration_hours is null or p_duration_hours < 1 or p_duration_hours > 168 then
    return jsonb_build_object('ok', false, 'error', 'invalid_duration');
  end if;
  if (p_item_id is null) = (p_currency_type is null) then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if p_currency_type is not null and p_currency_type not in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll') then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id for update;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select count(*) into v_active_listing_count
  from public.marketplace_listings ml
  join public.characters c on c.id = ml.seller_character_id
  where c.account_id = v_account_id and ml.status = 'active';
  if v_active_listing_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_listings');
  end if;

  if p_item_id is not null then
    select owner_id into v_owner_id from public.item_instances where id = p_item_id for update;
    if v_owner_id is null or v_owner_id <> p_character_id then
      return jsonb_build_object('ok', false, 'error', 'not_item_owner');
    end if;

    if exists (
      select 1 from public.characters
      where id = p_character_id
        and (
          equipped_weapon_id = p_item_id or equipped_ring_id = p_item_id or equipped_necklace_id = p_item_id
          or equipped_boots_id = p_item_id or equipped_hat_id = p_item_id or equipped_coat_id = p_item_id
          or equipped_quiver_id = p_item_id
        )
    ) then
      return jsonb_build_object('ok', false, 'error', 'item_equipped');
    end if;

    if exists (select 1 from public.marketplace_listings where item_id = p_item_id and status = 'active') then
      return jsonb_build_object('ok', false, 'error', 'already_listed');
    end if;

    if exists (select 1 from public.mail where item_id = p_item_id) then
      return jsonb_build_object('ok', false, 'error', 'item_in_mail');
    end if;
  else
    if p_currency_type = 'comet' then
      select comet_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'fallen_star' then
      select fallen_star_count into v_unit_count from public.characters where id = p_character_id for update;
    elsif p_currency_type = 'comet_scroll' then
      select comet_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    else
      select fallen_star_scroll_count into v_unit_count from public.characters where id = p_character_id for update;
    end if;
    if coalesce(v_unit_count, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_currency');
    end if;
  end if;

  v_fee := ceil(p_price_amount * 0.05);

  if p_price_currency = 'gold' then
    select gold into v_balance from public.characters where id = p_character_id;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'fee', v_fee);
    end if;
  else
    select ascension_points into v_balance from public.players where id = v_account_id for update;
    if v_balance < v_fee then
      return jsonb_build_object('ok', false, 'error', 'not_enough_ascension_points', 'fee', v_fee);
    end if;
  end if;

  -- Every guard has passed -- mutate now.
  if p_price_currency = 'gold' then
    update public.characters set gold = gold - v_fee where id = p_character_id returning gold into v_new_balance;
  else
    update public.players set ascension_points = ascension_points - v_fee where id = v_account_id
    returning ascension_points into v_new_balance;
  end if;

  if p_currency_type is not null then
    if p_currency_type = 'comet' then
      update public.characters set comet_count = comet_count - 1 where id = p_character_id;
    elsif p_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count - 1 where id = p_character_id;
    elsif p_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count - 1 where id = p_character_id;
    else
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count - 1 where id = p_character_id;
    end if;
  end if;

  insert into public.marketplace_listings
    (seller_character_id, item_id, currency_type, price_currency, price_amount, fee_amount, status, expires_at)
  values
    (p_character_id, p_item_id, p_currency_type, p_price_currency, p_price_amount, v_fee, 'active', now() + (p_duration_hours || ' hours')::interval)
  returning id into v_listing_id;

  return jsonb_build_object(
    'ok', true,
    'listing_id', v_listing_id,
    'fee', v_fee,
    'gold', case when p_price_currency = 'gold' then v_new_balance else null end,
    'ascension_points', case when p_price_currency = 'ascension_points' then v_new_balance else null end
  );
end;
$$;

-- ============================================================================
-- 13. claim_mail -- the only other function with hardcoded 'meteor'/
--     'dragonball'-family literals (buy_marketplace_listing/end_marketplace_
--     listing only ever forward currency_type generically, no literal
--     comparisons, so they need no changes here).
-- ============================================================================
create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_new_count integer;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type into v_mail_character_id, v_item_id, v_currency_type
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + 1 where id = p_character_id returning comet_count into v_new_count;
    elsif v_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count + 1 where id = p_character_id returning fallen_star_count into v_new_count;
    elsif v_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count + 1 where id = p_character_id
      returning comet_scroll_count into v_new_count;
    else
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + 1 where id = p_character_id
      returning fallen_star_scroll_count into v_new_count;
    end if;

    delete from public.mail where id = p_mail_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  delete from public.mail where id = p_mail_id;

  return jsonb_build_object('ok', true, 'item_id', v_item_id);
end;
$$;

-- ============================================================================
-- 14. pick_lucky_reward / draw_lucky_ticket
-- ============================================================================
create or replace function public.pick_lucky_reward()
returns jsonb
language plpgsql
as $$
declare
  v_roll numeric := random() * 100;
  v_cumulative numeric := 0;
  v_row record;
begin
  for v_row in
    select * from (values
      ('gold', 25, 30::numeric),
      ('gold', 50, 20::numeric),
      ('gold', 100, 15::numeric),
      ('gold', 200, 10::numeric),
      ('gold', 400, 7::numeric),
      ('gold', 750, 5::numeric),
      ('gold', 1500, 4::numeric),
      ('gold', 3000, 3::numeric),
      ('gold', 6000, 2::numeric),
      ('gold', 12000, 1.5::numeric),
      ('comet', 1, 1.5::numeric),
      ('fallen_star', 1, 0.7::numeric),
      ('comet_scroll', 1, 0.25::numeric),
      ('fallen_star_scroll', 1, 0.05::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'gold', 'amount', 25);
end;
$$;

create or replace function public.draw_lucky_ticket(p_character_id uuid, p_card_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_free_claimed_at timestamptz;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_free_available boolean;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_board jsonb := '[]'::jsonb;
  v_won jsonb;
  v_kind text;
  v_amount integer;
  v_new_gold integer;
  v_new_comet_count integer;
  v_new_fallen_star_count integer;
  v_new_comet_scroll_count integer;
  v_new_fallen_star_scroll_count integer;
  v_next_free_at timestamptz;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         lucky_free_ticket_claimed_at
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_free_claimed_at
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_free_available := v_free_claimed_at is null or now() - v_free_claimed_at >= interval '6 hours';

  if v_free_available then
    v_payment := 'free';
  else
    v_payment := 'ascension_points';
    -- Same players-then-characters lock ordering as sell_item/
    -- create_marketplace_listing (characters already locked above) — avoids
    -- deadlocking against a concurrent call touching both rows the other way.
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 20 then
      v_next_free_at := v_free_claimed_at + interval '6 hours';
      return jsonb_build_object(
        'ok', false, 'error', 'not_enough_ap', 'cost', 20, 'ascension_points', v_ap_balance,
        'next_free_ticket_at', v_next_free_at
      );
    end if;
  end if;

  -- Roll the whole board now that eligibility is confirmed. Still nothing to
  -- read from outside this function — it's a local variable inside a single
  -- request that hasn't returned yet.
  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_won := v_board -> p_card_index;
  v_kind := v_won ->> 'kind';
  v_amount := (v_won ->> 'amount')::integer;

  if v_payment = 'ascension_points' then
    update public.players set ascension_points = ascension_points - 20 where id = v_account_id
    returning ascension_points into v_new_ap;
  else
    update public.characters set lucky_free_ticket_claimed_at = now() where id = p_character_id;
  end if;

  v_new_gold := v_gold;
  v_new_comet_count := v_comet_count;
  v_new_fallen_star_count := v_fallen_star_count;
  v_new_comet_scroll_count := v_comet_scroll_count;
  v_new_fallen_star_scroll_count := v_fallen_star_scroll_count;

  if v_kind = 'gold' then
    v_new_gold := v_gold + v_amount;
  elsif v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'fallen_star' then
    v_new_fallen_star_count := v_fallen_star_count + 1;
  elsif v_kind = 'comet_scroll' then
    v_new_comet_scroll_count := v_comet_scroll_count + 1;
  elsif v_kind = 'fallen_star_scroll' then
    v_new_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
  end if;

  update public.characters
  set
    gold = v_new_gold,
    comet_count = v_new_comet_count,
    fallen_star_count = v_new_fallen_star_count,
    comet_scroll_count = v_new_comet_scroll_count,
    fallen_star_scroll_count = v_new_fallen_star_scroll_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '6 hours' into v_next_free_at
  from public.characters where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'won_index', p_card_index,
    'payment', v_payment,
    'cost', case when v_payment = 'ascension_points' then 20 else 0 end,
    'character', jsonb_build_object(
      'gold', v_new_gold,
      'comet_count', v_new_comet_count,
      'fallen_star_count', v_new_fallen_star_count,
      'comet_scroll_count', v_new_comet_scroll_count,
      'fallen_star_scroll_count', v_new_fallen_star_scroll_count
    ),
    'ascension_points', v_new_ap,
    'next_free_ticket_at', v_next_free_at
  );
end;
$$;

-- ============================================================================
-- 15. bank_currency_item
-- ============================================================================
create or replace function public.bank_currency_item(
  character_id uuid,
  currency_type text,
  direction text,
  amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_count integer;
  v_bank_count integer;
begin
  if currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;
  if amount is null or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id from public.characters where id = character_id for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if currency_type = 'comet' then
    select comet_count into v_count from public.characters where id = character_id;
    select comet_bank_count into v_bank_count from public.players where id = v_account_id for update;
  else
    select fallen_star_count into v_count from public.characters where id = character_id;
    select fallen_star_bank_count into v_bank_count from public.players where id = v_account_id for update;
  end if;

  if direction = 'deposit' then
    if v_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_count := v_count - amount;
    v_bank_count := v_bank_count + amount;
  else
    if v_bank_count < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_count := v_bank_count - amount;
    v_count := v_count + amount;
  end if;

  if currency_type = 'comet' then
    update public.characters set comet_count = v_count where id = character_id;
    update public.players set comet_bank_count = v_bank_count where id = v_account_id;
  else
    update public.characters set fallen_star_count = v_count where id = character_id;
    update public.players set fallen_star_bank_count = v_bank_count where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'bank_count', v_bank_count);
end;
$$;

commit;
