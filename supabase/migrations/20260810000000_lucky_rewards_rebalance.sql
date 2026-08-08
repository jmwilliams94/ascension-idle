-- Lucky Lad rebalance (2026-08-10, follow-up to 20260809000000/
-- 20260809010000) — confirmed with the user: Money Bags were dominating
-- draws (70% combined weight) and needed to come down significantly, and the
-- Class 1-10 gold values needed a new ramp. Weight table sums to exactly 100
-- (see pick_lucky_reward below); category shares now roughly: Money Bag 30%,
-- currency (Comet/Fallen Star/Scrolls) 3.5%, Gem Bag 21%, Composition Stone
-- 39.5%, Gem Tempered/Ascended 5.7%, hyper-rare/Ascended gear 0.3%.
begin;

-- New Class 1-10 gold ramp.
update public.item_templates set price = v.price
from (values
  ('Class 1 Money Bag', 50000),
  ('Class 2 Money Bag', 100000),
  ('Class 3 Money Bag', 200000),
  ('Class 4 Money Bag', 400000),
  ('Class 5 Money Bag', 800000),
  ('Class 6 Money Bag', 1500000),
  ('Class 7 Money Bag', 3000000),
  ('Class 8 Money Bag', 6000000),
  ('Class 9 Money Bag', 9000000),
  ('Class 10 Money Bag', 15000000)
) as v(name, price)
where item_templates.name = v.name;

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
      -- Money Bag classes 1-10 (amount = class number, not gold — the
      -- template's own `price` column holds the actual gold value).
      -- Total 30 (was 70) — was overwhelmingly the most common reward.
      ('money_bag', 1, 12::numeric),
      ('money_bag', 2, 7::numeric),
      ('money_bag', 3, 4.5::numeric),
      ('money_bag', 4, 3::numeric),
      ('money_bag', 5, 1.8::numeric),
      ('money_bag', 6, 1::numeric),
      ('money_bag', 7, 0.5::numeric),
      ('money_bag', 8, 0.15::numeric),
      ('money_bag', 9, 0.04::numeric),
      ('money_bag', 10, 0.01::numeric),
      -- Currency, total 3.5 (was 2.5).
      ('comet', 1, 2.0::numeric),
      ('fallen_star', 1, 1.0::numeric),
      ('comet_scroll', 1, 0.4::numeric),
      ('fallen_star_scroll', 1, 0.1::numeric),
      -- Gem Bag, total 21 (was 7.5).
      ('gem_bag', 1, 21.0::numeric),
      -- Composition Stone, amount = tier (1-6), total 39.5 (was 19.45).
      ('composition_stone', 1, 20.0::numeric),
      ('composition_stone', 2, 12.0::numeric),
      ('composition_stone', 3, 5.5::numeric),
      ('composition_stone', 4, 1.5::numeric),
      ('composition_stone', 5, 0.4::numeric),
      ('composition_stone', 6, 0.1::numeric),
      -- Gems granted directly, total 5.7 (was 0.44).
      ('gem_tempered', 1, 5.0::numeric),
      ('gem_ascended', 1, 0.7::numeric),
      -- Hyper-rare pre-made gear, total 0.3 (was 0.11).
      ('gear_radiant_bow', 1, 0.02::numeric),
      ('gear_radiant_coat', 1, 0.02::numeric),
      ('gear_ascended_random', 1, 0.26::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'money_bag', 'amount', 1);
end;
$$;

commit;
