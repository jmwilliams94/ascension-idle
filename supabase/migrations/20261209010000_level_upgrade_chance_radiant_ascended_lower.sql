-- Further lowers Radiant/Ascended Level Upgrade success chance (requested by
-- the user, 2026-09-02, same day as 20261209000000_level_upgrade_chance_retune.sql):
--   Radiant:  25 -> 15  becomes  15 -> 10
--   Ascended: 20 -> 10  becomes  10 -> 5
-- Normal/Tempered/Infused and Quality Upgrade's own range are unchanged.
-- Master Forge's cost reads this same function, so it adjusts automatically.
-- Same signature as the existing compute_upgrade_success_chance_pct -- no
-- drop needed, plain create or replace.
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

  if p_upgrade_type = 'level' then
    v_base_min := case p_quality_tier
      when 'tempered' then 75
      when 'infused' then 50
      when 'radiant' then 15
      when 'ascended' then 10
      else 100 -- normal
    end;
    v_base_max := case p_quality_tier
      when 'tempered' then 50
      when 'infused' then 25
      when 'radiant' then 10
      when 'ascended' then 5
      else 80 -- normal
    end;
    v_max_clamp := 100;
    v_chance := v_base_min - v_t * (v_base_min - v_base_max);
  else
    v_quality_index := case p_quality_tier
      when 'normal' then 0
      when 'tempered' then 1
      when 'infused' then 2
      when 'radiant' then 3
      when 'ascended' then 4
      else 0
    end;
    v_base_min := 85;
    v_base_max := 75;
    v_tier_multiplier := 0.58;
    v_max_clamp := 99;
    v_chance := (v_base_min - v_t * (v_base_min - v_base_max)) * power(v_tier_multiplier, v_quality_index);
  end if;

  -- Clamped away from a guaranteed-fail on the low end always; a
  -- guaranteed-success on the high end is only allowed for Level Upgrade
  -- (v_max_clamp = 100), still disallowed for Quality Upgrade (99).
  return greatest(1, least(v_max_clamp, v_chance));
end;
$$;

commit;
