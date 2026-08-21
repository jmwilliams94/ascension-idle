-- Raises Level Upgrade's Normal-quality success chance range again (requested
-- by the user, 2026-08-21): 95%->75% (lowest->highest level in the family
-- chain) becomes 100%->80%. Quality Upgrade's 85%->75% range and the ×0.58
-- per-quality-tier-above-Normal multiplier are both unchanged.
--
-- A literal 100% at the lowest level means the existing greatest(1, least(99,
-- ...)) clamp would silently cap Level Upgrade at 99% -- the user confirmed
-- they want a true guaranteed-success roll at the low end for this upgrade
-- type specifically, so the clamp's upper bound is now 100 for
-- p_upgrade_type = 'level' and stays 99 for 'quality' (the "never a
-- guaranteed roll" design principle still holds there). Same signature as the
-- existing compute_upgrade_success_chance_pct -- no drop needed, plain create
-- or replace.
begin;

create or replace function public.compute_upgrade_success_chance_pct(
  p_item_family text,
  p_required_level integer,
  p_quality_tier text,
  p_upgrade_type text
)
returns numeric
language plpgsql
as $$
declare
  v_min_level integer;
  v_max_level integer;
  v_t numeric;
  v_base_min numeric;
  v_base_max numeric;
  v_quality_index integer;
  v_tier_multiplier numeric;
  v_chance numeric;
  v_max_clamp numeric;
begin
  select min(required_level), max(required_level)
  into v_min_level, v_max_level
  from public.item_templates
  where item_family = p_item_family;

  if v_min_level is null or v_max_level is null or v_max_level <= v_min_level then
    v_t := 0;
  else
    v_t := greatest(0, least(1, (p_required_level - v_min_level)::numeric / (v_max_level - v_min_level)));
  end if;

  v_quality_index := case p_quality_tier
    when 'normal' then 0
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  if p_upgrade_type = 'level' then
    v_base_min := 100;
    v_base_max := 80;
    v_tier_multiplier := 0.5;
    v_max_clamp := 100;
  else
    v_base_min := 85;
    v_base_max := 75;
    v_tier_multiplier := 0.58;
    v_max_clamp := 99;
  end if;

  v_chance := (v_base_min - v_t * (v_base_min - v_base_max)) * power(v_tier_multiplier, v_quality_index);

  -- Clamped away from a guaranteed-fail on the low end always; a
  -- guaranteed-success on the high end is now allowed for Level Upgrade only
  -- (v_max_clamp = 100), still disallowed for Quality Upgrade (99).
  return greatest(1, least(v_max_clamp, v_chance));
end;
$$;

commit;
