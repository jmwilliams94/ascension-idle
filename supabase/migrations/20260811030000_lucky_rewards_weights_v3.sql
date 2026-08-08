-- Lucky Lad weight table v3 (2026-08-11, follow-up to
-- 20260810010000_lucky_rewards_weights_v2.sql) — user-supplied rebalance:
-- Hyper Rare cut from 0.5 to 0.2 (the 0.3 difference reallocated entirely
-- into Class 1 Money Bag), Common/Uncommon/Rare bands otherwise reshuffled
-- within themselves. Weights sum to exactly 100: Common 61.9 / Uncommon
-- 28.0 / Rare 9.9 / Hyper Rare 0.2.
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
      -- ===== Common (61.9) =====
      ('money_bag', 1, 16.3::numeric),
      ('money_bag', 2, 12.0::numeric),
      ('comet', 1, 9.0::numeric),
      ('money_bag', 3, 7.0::numeric),
      ('composition_stone', 1, 5.5::numeric),
      ('money_bag', 4, 4.0::numeric),
      ('composition_stone', 2, 3.5::numeric),
      ('gem_bag', 1, 2.6::numeric),
      ('composition_stone', 3, 2.0::numeric),
      -- ===== Uncommon (28.0) =====
      ('comet_scroll', 1, 8.0::numeric),
      ('gem_tempered', 1, 8.0::numeric),
      ('money_bag', 5, 5.5::numeric),
      ('composition_stone', 4, 3.5::numeric),
      ('money_bag', 6, 2.0::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (9.9) =====
      ('fallen_star', 1, 4.0::numeric),
      ('gem_ascended', 1, 3.0::numeric),
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('money_bag', 10, 0.1::numeric),
      -- ===== Hyper Rare (0.2, was 0.5) =====
      ('gear_ascended_random', 1, 0.08::numeric),
      ('gear_radiant_bow', 1, 0.06::numeric),
      ('gear_radiant_coat', 1, 0.06::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'comet', 'amount', 1);
end;
$$;
