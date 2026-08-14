-- Fix a regression: 20260821080000_lucky_comet_box_reward.sql (adding the
-- Comet Box reward) redefined pick_lucky_reward() from a stale copy of the
-- function body that predates 20260813010000_split_lucky_gem_rewards_by_type
-- -- it reintroduced the old bare 'gem_tempered'/'gem_ascended' kind rows
-- (8.0 and 3.0 weight) instead of the 8 per-gem-type kinds
-- (gem_tempered_drake/ember/bastion/iris, gem_ascended_drake/ember/bastion/
-- iris) that migration had already split them into.
--
-- Impact while this was live: any of the 9 board cards that rolled the bare
-- kind had no matching case in LuckyPanel.tsx's rewardVisual()/rewardLabel()
-- switches, so `visual` came back undefined and the card silently stayed
-- rendered as a closed chest forever (reported by the user: "not all the
-- other chests turn over", and one stuck card in a bulk 8/9 draw). Worse: if
-- the *won* card (single draw) or any card (bulk draw) itself rolled the bare
-- kind, draw_lucky_ticket's/draw_lucky_ticket_bulk's grant logic checks
-- `v_kind like 'gem\_tempered\_%'` — which a bare 'gem_tempered' (no
-- trailing `_<id>`) does not match — so the player was charged and received
-- nothing at all.
--
-- Fix: restore the 8-way split, keeping the Aug 21 Comet Box row intact.
--
-- Also (2026-08-23, requested by the user): Comet Box's weight raised from
-- 1.0 to 4.0 to match Fallen Star's own weight exactly, same 3.0 additionally
-- trimmed from Class 1 Money Bag (15.3 -> 12.3) using the same "fund a new/
-- reweighted rare off the single largest weight" convention the original
-- Comet Box migration used. Total weight is still exactly 100 (Common 57.9 /
-- Uncommon 28.0 / Rare 13.9 / Hyper Rare 0.2).
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
      -- ===== Common (57.9) =====
      ('money_bag', 1, 12.3::numeric),
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
      ('gem_tempered_drake', 1, 2.0::numeric),
      ('gem_tempered_ember', 1, 2.0::numeric),
      ('gem_tempered_bastion', 1, 2.0::numeric),
      ('gem_tempered_iris', 1, 2.0::numeric),
      ('money_bag', 5, 5.5::numeric),
      ('composition_stone', 4, 3.5::numeric),
      ('money_bag', 6, 2.0::numeric),
      ('money_bag', 7, 0.7::numeric),
      ('money_bag', 8, 0.3::numeric),
      -- ===== Rare (13.9) =====
      ('fallen_star', 1, 4.0::numeric),
      ('gem_ascended_drake', 1, 0.75::numeric),
      ('gem_ascended_ember', 1, 0.75::numeric),
      ('gem_ascended_bastion', 1, 0.75::numeric),
      ('gem_ascended_iris', 1, 0.75::numeric),
      ('comet_box', 100, 4.0::numeric),
      ('fallen_star_scroll', 1, 0.4::numeric),
      ('composition_stone', 5, 1.5::numeric),
      ('composition_stone', 6, 0.6::numeric),
      ('money_bag', 9, 0.3::numeric),
      ('money_bag', 10, 0.1::numeric),
      -- ===== Hyper Rare (0.2) =====
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
