-- Lucky Lad weight table v2 (2026-08-10, follow-up to
-- 20260810000000_lucky_rewards_rebalance.sql) — user-supplied full
-- rewrite, organized into four informal rarity bands (Common/Uncommon/
-- Rare/Hyper Rare) for readability only — pick_lucky_reward() itself has no
-- concept of tiers, just one flat weighted list. Weights are direct
-- percentage drop chances (the roll is 0-100) and sum to exactly 100:
-- Common 61.6 / Uncommon 28.0 / Rare 9.9 / Hyper Rare 0.5.
--
-- Money Bag gold values (item_templates.price) are unchanged from the
-- previous migration — only the roll weights change here.
begin;

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
      -- ===== Common (61.6) =====
      ('comet', 1, 14.0::numeric),
      ('gem_bag', 1, 13.6::numeric),
      ('composition_stone', 1, 10.0::numeric),
      ('composition_stone', 2, 8.0::numeric),
      ('composition_stone', 3, 6.0::numeric),
      ('money_bag', 1, 5.0::numeric),
      ('money_bag', 2, 3.0::numeric),
      ('money_bag', 3, 1.5::numeric),
      ('money_bag', 4, 0.5::numeric),
      -- ===== Uncommon (28.0) =====
      ('comet_scroll', 1, 8.0::numeric),
      ('gem_tempered', 1, 8.0::numeric),
      ('composition_stone', 4, 6.0::numeric),
      ('money_bag', 5, 3.5::numeric),
      ('money_bag', 6, 1.5::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (9.9) =====
      ('fallen_star', 1, 4.0::numeric),
      ('gem_ascended', 1, 3.0::numeric),
      -- Fixed at Fallen Star / 10, per the user's own design rule.
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('money_bag', 10, 0.1::numeric),
      -- ===== Hyper Rare (0.5) =====
      ('gear_ascended_random', 1, 0.2::numeric),
      ('gear_radiant_bow', 1, 0.15::numeric),
      ('gear_radiant_coat', 1, 0.15::numeric)
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

commit;
