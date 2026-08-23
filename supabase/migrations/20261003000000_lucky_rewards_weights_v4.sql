-- Lucky Lad reward table rebalance v4:
--   * Gem Bag raised from 2.6 -> 5.5 (now matches Composition Stone 1).
--   * Comet Box dropped from 4.0 -> 0.4 (now matches Fallen Star Scroll).
--   * Fallen Star dropped from 4.0 -> 2.0.
--   * Composition Stone tiers 7/8/9 added (0.2 / 0.07 / 0.02) — tiers already
--     exist client-side (icons/tooltips go up to 9), just never granted here.
--   * Class 1 Money Bag absorbs the net 2.41 surplus these changes free up
--     (11.78 -> 14.19), same shock-absorber role as prior rebalances, so the
--     table still sums to exactly 100.
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
      -- ===== Common (62.69) =====
      ('money_bag', 1, 14.19::numeric),
      ('money_bag', 2, 12.0::numeric),
      ('comet', 1, 9.0::numeric),
      ('money_bag', 3, 7.0::numeric),
      ('composition_stone', 1, 5.5::numeric),
      ('gem_bag', 1, 5.5::numeric),
      ('money_bag', 4, 4.0::numeric),
      ('composition_stone', 2, 3.5::numeric),
      ('composition_stone', 3, 2.0::numeric),
      -- ===== Uncommon (28.0) =====
      ('comet_scroll', 1, 8.0::numeric),
      ('gem_tempered_drake', 1, 2.0::numeric),
      ('gem_tempered_ember', 1, 2.0::numeric),
      ('gem_tempered_bastion', 1, 2.0::numeric),
      ('gem_tempered_iris', 1, 2.0::numeric),
      ('money_bag', 5, 5.5::numeric),
      ('composition_stone', 4, 3.5::numeric),
      ('money_bag', 6, 2.0::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (9.09) =====
      ('fallen_star', 1, 2.0::numeric),
      ('gem_ascended_drake', 1, 0.75::numeric),
      ('gem_ascended_ember', 1, 0.75::numeric),
      ('gem_ascended_bastion', 1, 0.75::numeric),
      ('gem_ascended_iris', 1, 0.75::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('comet_box', 100, 0.4::numeric),
      ('moon_box', 1, 0.5::numeric),
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 7, 0.2::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('composition_stone', 8, 0.07::numeric),
      ('money_bag', 10, 0.1::numeric),
      ('composition_stone', 9, 0.02::numeric),
      -- ===== Hyper Rare (0.22) =====
      ('gear_ascended_random', 1, 0.08::numeric),
      ('gear_radiant_bow', 1, 0.06::numeric),
      ('gear_radiant_coat', 1, 0.06::numeric),
      ('vip_token', 1, 0.02::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;
  return jsonb_build_object('kind', 'comet', 'amount', 1);
end;
$$;

commit;
