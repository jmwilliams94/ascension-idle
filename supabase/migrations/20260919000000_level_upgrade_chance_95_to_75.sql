-- Raises Level Upgrade's Normal-quality success chance range (requested by
-- the user, 2026-08-19): 90%->60% (lowest->highest level in the family
-- chain) becomes 95%->75%. Quality Upgrade's 85%->75% range and the ×0.5
-- per-quality-tier-above-Normal multiplier are both unchanged. Same
-- signature as the existing compute_upgrade_success_chance_pct (defined in
-- 20260805030000_dynamic_upgrade_chance_and_master_forge.sql) -- no drop
-- needed, plain create or replace.
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
    v_base_min := 95;
    v_base_max := 75;
    v_tier_multiplier := 0.5;
  else
    v_base_min := 85;
    v_base_max := 75;
    v_tier_multiplier := 0.58;
  end if;

  v_chance := (v_base_min - v_t * (v_base_min - v_base_max)) * power(v_tier_multiplier, v_quality_index);

  -- Clamped away from the literal 0/100 edges — a guaranteed-fail or
  -- guaranteed-succeed roll from this formula was never the intent, just a
  -- very hard or very easy one.
  return greatest(1, least(99, v_chance));
end;
$$;

commit;
