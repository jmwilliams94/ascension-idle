-- Stage 1 of the Bank/Warehouse economy redesign confirmed with the user
-- (2026-07-31, see CLAUDE.md's Accounts & Characters -> Warehouse note).
-- Meteors and DragonBalls stop being an invisible per-character wallet
-- balance and become real, individual, non-stacking Inventory items --
-- joining Composition Stones' existing pattern. Gold and Stones themselves
-- are unaffected.
--
-- The underlying storage doesn't need to reshape (it was already a plain
-- per-character integer count) -- renaming signals the meaning changed
-- (an owned Inventory-tile count, not a spendable wallet balance) without a
-- disruptive drop-and-recreate. Cost formulas (Forge) and the Bank's 1:1
-- swap mechanic (transfer_currency) are intentionally unchanged in this
-- stage -- only column references move; see the redesign note for the
-- later stages that touch those.
begin;

alter table public.characters rename column meteors to meteor_count;
alter table public.characters rename column dragonballs to dragonball_count;

-- ============================================================================
-- loot_holding: extend to also hold a pending currency-type drop (Meteor/
-- DragonBall) alongside its existing gear-type one, so a full-inventory
-- currency drop overflows here exactly like a full-inventory gear drop
-- already does. A row is either a gear row (template_id set) or a currency
-- row (currency_type set) -- never both, never neither.
-- ============================================================================
alter table public.loot_holding
  alter column template_id drop not null,
  alter column quality_tier drop not null,
  add column if not exists currency_type text check (currency_type in ('meteor', 'dragonball'));

do $$ begin
  alter table public.loot_holding
    add constraint loot_holding_kind_check
    check ((template_id is not null) <> (currency_type is not null));
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- claim_loot_holding: branches on which kind of row this is now. A currency
-- row's claim increments meteor_count/dragonball_count directly -- no
-- item_instances insert, since a Meteor/DragonBall isn't template-backed.
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
    if v_currency_type = 'meteor' then
      update public.characters set meteor_count = meteor_count + 1 where id = v_character_id
      returning meteor_count into v_new_count;
    else
      update public.characters set dragonball_count = dragonball_count + 1 where id = v_character_id
      returning dragonball_count into v_new_count;
    end if;

    delete from public.loot_holding where id = holding_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  insert into public.item_instances (template_id, owner_id, quality_tier)
  values (v_template_id, v_character_id, v_quality_tier)
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

grant execute on function public.claim_loot_holding(uuid) to authenticated;

-- ============================================================================
-- quality_upgrade / level_upgrade / grant_currency_reward / transfer_currency:
-- CREATE OR REPLACE, updated to reference meteor_count/dragonball_count.
-- Cost formulas and the 1:1 Bank swap mechanic are UNCHANGED in this stage.
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
  v_cost integer;
  v_success_chance numeric := 0.7;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier into v_character_id, v_current_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, dragonball_count into v_account_id, v_dragonballs
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

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

  v_cost := case v_current_tier
    when 'normal' then 1
    when 'refined' then 2
    when 'unique' then 3
    when 'elite' then 4
    else 1
  end;

  if v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', v_dragonballs
    );
  end if;

  update public.characters set dragonball_count = dragonball_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'dragonballs_spent', v_cost,
    'dragonballs_remaining', v_dragonballs - v_cost
  );
end;
$$;

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
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_cost integer;
  v_success_chance numeric := 0.8;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level, template_id into v_character_id, v_current_level, v_template_id
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, meteor_count into v_account_id, v_meteors
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, required_level into v_item_family, v_required_level
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

  v_cost := 1 + (v_current_level / 5);

  if v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', v_meteors
    );
  end if;

  update public.characters set meteor_count = meteor_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost
  );
end;
$$;

grant execute on function public.quality_upgrade(uuid) to authenticated;
grant execute on function public.level_upgrade(uuid) to authenticated;

create or replace function public.grant_currency_reward(character_id uuid, meteors_gained integer, dragonballs_gained integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_meteors integer;
  v_dragonballs integer;
begin
  if meteors_gained < 0 or dragonballs_gained < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id from public.characters where id = character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.characters
  set meteor_count = meteor_count + meteors_gained, dragonball_count = dragonball_count + dragonballs_gained
  where id = character_id
  returning meteor_count, dragonball_count into v_meteors, v_dragonballs;

  return jsonb_build_object('ok', true, 'meteors', v_meteors, 'dragonballs', v_dragonballs);
end;
$$;

grant execute on function public.grant_currency_reward(uuid, integer, integer) to authenticated;

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
begin
  if currency not in ('gold', 'meteors', 'dragonballs') then
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
  elsif currency = 'meteors' then
    select meteor_count into v_character_balance from public.characters where id = character_id;
    select bank_meteors into v_bank_balance from public.players where id = v_account_id;
  else
    select dragonball_count into v_character_balance from public.characters where id = character_id;
    select bank_dragonballs into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if v_character_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_character_balance := v_character_balance - amount;
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
  elsif currency = 'meteors' then
    update public.characters set meteor_count = v_character_balance where id = character_id;
    update public.players set bank_meteors = v_bank_balance where id = v_account_id;
  else
    update public.characters set dragonball_count = v_character_balance where id = character_id;
    update public.players set bank_dragonballs = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'character_balance', v_character_balance, 'bank_balance', v_bank_balance);
end;
$$;

grant execute on function public.transfer_currency(uuid, text, integer, text) to authenticated;

commit;
