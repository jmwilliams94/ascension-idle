-- Halve repair costs across the entire scale (requested by the user).
-- compute_repair_cost's full-break cost curve was 7,500 (level 1) to 100,000
-- (level 130), geometrically interpolated, then scaled by quality multiplier
-- and missing-durability fraction. Halving both curve endpoints preserves the
-- same ratio (so the geometric shape/relative pacing is unchanged) while
-- scaling every resulting cost by exactly 0.5, since fullBreakCost =
-- A * (B/A)^t is invariant to halving both A and B other than an overall 0.5
-- factor. Mirrors src/game/items/equipmentBonus.ts's computeRepairCost
-- exactly — keep in sync. Signature unchanged from the last edit
-- (20260814010000_rescale_repair_cost.sql), so a plain create-or-replace is
-- safe here (no overload-ambiguity risk).
begin;

create or replace function public.compute_repair_cost(
  required_level integer,
  quality_tier text,
  current_durability numeric,
  max_durability numeric
)
returns integer
language plpgsql
as $$
declare
  v_multiplier numeric;
  v_t numeric;
  v_full_break_cost numeric;
  v_missing_fraction numeric;
begin
  if max_durability is null or max_durability <= 0 then
    return 0;
  end if;

  v_multiplier := case quality_tier
    when 'normal' then 1
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;

  v_t := greatest(0, least(1, (required_level - 1)::numeric / 129));
  v_full_break_cost := 3750 * power(50000.0 / 3750, v_t);

  v_missing_fraction := greatest(0, least(1, (max_durability - current_durability) / max_durability));

  return round(v_full_break_cost * v_multiplier * v_missing_fraction)::integer;
end;
$$;

revoke all on function public.compute_repair_cost(integer, text, numeric, numeric) from public;

commit;
