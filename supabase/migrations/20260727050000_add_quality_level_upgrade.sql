-- Quality Upgrade and Level Upgrade (see CLAUDE.md's Gear system section).
-- Deliberately excludes Composition and Sockets — a later step — but the schema
-- changes here leave room for them.

-- Forge currencies, per CLAUDE.md (Meteors = Level Upgrade, DragonBalls = Quality
-- Upgrade + weapon sockets later).
alter table public.players
  add column if not exists meteors integer not null default 0,
  add column if not exists dragonballs integer not null default 0;

alter table public.players
  add constraint players_meteors_check check (meteors >= 0),
  add constraint players_dragonballs_check check (dragonballs >= 0);

-- Item's own level (Level Upgrade), separate from the player's character level.
-- Cap is a placeholder (130) per CLAUDE.md — not enforced as a DB constraint since
-- the cap itself is unresolved and easier to change in the function than a CHECK.
alter table public.item_instances
  add column if not exists level integer not null default 1;

alter table public.item_instances
  add constraint item_instances_level_check check (level >= 1);

-- Every item now has a quality tier from the start (was nullable/unused while
-- quality upgrades didn't exist yet).
update public.item_instances set quality_tier = 'normal' where quality_tier is null;

alter table public.item_instances
  alter column quality_tier set default 'normal',
  alter column quality_tier set not null;

alter table public.item_instances
  add constraint item_instances_quality_tier_check
    check (quality_tier in ('normal', 'refined', 'unique', 'elite', 'super'));

-- item_instances already has no client-side UPDATE policy or grant (see
-- 20260727030000 and 20260727040000) — quality_tier/level/composition_level/
-- sockets/enchant remain impossible to touch via a normal client update() call.
-- The two functions below are SECURITY DEFINER, so they bypass RLS internally to
-- perform the actual writes; nothing else needs to change on that front.

create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_current_tier text;
  v_next_tier text;
  -- PLACEHOLDER cost/success chance — real values are unresolved per CLAUDE.md.
  v_cost integer := 1;
  v_success_chance numeric := 0.7;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier into v_owner_id, v_current_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if v_owner_id <> auth.uid() then
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

  select dragonballs into v_dragonballs from public.players where id = auth.uid() for update;

  if v_dragonballs is null or v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', coalesce(v_dragonballs, 0)
    );
  end if;

  -- Currency is spent on the attempt regardless of outcome — deduct and roll in the
  -- same transaction as the (possible) item write, so there's no window where the
  -- cost is paid without the outcome being applied consistently.
  update public.players set dragonballs = dragonballs - v_cost where id = auth.uid();
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
  v_owner_id uuid;
  v_current_level integer;
  -- PLACEHOLDER cap/cost/success chance — real values are unresolved per CLAUDE.md.
  v_level_cap integer := 130;
  v_cost integer := 1;
  v_success_chance numeric := 0.8;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level into v_owner_id, v_current_level
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if v_owner_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_current_level >= v_level_cap then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  select meteors into v_meteors from public.players where id = auth.uid() for update;

  if v_meteors is null or v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', coalesce(v_meteors, 0)
    );
  end if;

  update public.players set meteors = meteors - v_cost where id = auth.uid();
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set level = level + 1 where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_current_level + 1 else v_current_level end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost
  );
end;
$$;

-- Functions get PUBLIC execute by default on creation — lock that down explicitly
-- rather than relying on it never having been granted.
revoke all on function public.quality_upgrade(uuid) from public;
revoke all on function public.level_upgrade(uuid) from public;
grant execute on function public.quality_upgrade(uuid) to authenticated;
grant execute on function public.level_upgrade(uuid) to authenticated;
