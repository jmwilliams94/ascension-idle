-- Recompounds Backsword's physical_attack/magic_attack and Bracelet's
-- magic_attack for required_level > 110/115 (v1.130.4).
--
-- Root cause (reported by the user: "Wuxard is doing an insane amount of
-- damage compared to other Wuxia's"): Backsword's magic_attack grows
-- smoothly from required_level 15 through 110 (~3.6%/level, close to a
-- clean compounding curve, matching Bow's own post-recompound shape) but
-- then jumps to a flat +69/level from 110 straight through 130 -- a ~4-5x
-- steeper per-level rate exactly in the bracket a level-127 Wuxia (the
-- account's highest-level Wuxia, first to reach it) sits in. Verified via
-- live data: with Ascended quality, +7 composition on both weapon/ring, and
-- 4 Ember Ascended gems (all legitimate, no exploit), that character's
-- computed magic attack one-shot a 2,334-HP endgame monster the game's own
-- pacing target says should take 6-9 hits. The next-highest Wuxia (one
-- gear bracket lower, still short of the level-120 breakpoint) lands a much
-- more reasonable ~2 hits on her own level-matched monster -- the gap is
-- explained almost entirely by crossing this breakpoint, not by anything
-- account-specific.
--
-- Backsword/Bracelet were deliberately EXCLUDED from the original
-- 20261101000000_recompound_weapon_curves.sql pass (see
-- 20261103000000_fix_backsword_and_level5_regression.sql) specifically to
-- preserve their real Conquer-reference-sourced numbers. This migration
-- narrows that decision rather than reversing it outright: every value at
-- required_level <= 110 (Backsword) / <= 115 (Bracelet) is untouched --
-- that whole range was already smooth and matches this same curve almost
-- exactly, so nothing below the breakpoint changes for existing
-- lower-level Wuxia gear. Only the runaway 111-130 tail is replaced,
-- continuing the SAME rate the sourced data already established instead of
-- accelerating away from it:
--   Backsword magic_attack: rate solved from (required_level 15 = 11) to
--   (required_level 110 = 324) -> ~3.625%/level, extended forward.
--   Backsword physical_attack: same two anchor levels (10 -> 311) ->
--   ~3.684%/level, extended forward.
--   Bracelet magic_attack: rate solved from (required_level 95 = 98) to
--   (required_level 115 = 171) -> ~2.823%/level, extended forward for the
--   115/117/122/127 tail (Bracelet has no required_level 130 row at all --
--   pre-existing, not something this migration adds).
--
-- Paired with combatResolver.ts's MONSTER_MAGIC_DEFENSE_ANCHORS (and its
-- resolve-combat/index.ts mirror + zone_boss_magic_defense_base() SQL
-- mirror below) being recomputed off these new numbers, per that table's
-- own "recompute this if Backsword/Bracelet ever change" comment. The
-- 100/105/110 anchors are untouched (nothing below the breakpoint moved);
-- 115/120/125/130 are recomputed using the exact same formula the table
-- was originally derived with (verified by reproducing the *old* 110 and
-- 130 anchors first -- both matched the live table exactly before any new
-- numbers were substituted in).
--
-- Retroactive, same as every other item_templates change: base_stats are
-- read live at combat/tooltip time, not baked into item_instances at drop
-- time, so this applies to every already-owned Backsword/Bracelet
-- instantly on deploy.
begin;

-- Backsword (recompounded tail only, required_level 115-130; 15-110 untouched)
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 373, 'magic_attack', 387) where item_family = 'backsword' and required_level = 115;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 447, 'magic_attack', 463) where item_family = 'backsword' and required_level = 120;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 463, 'magic_attack', 479) where item_family = 'backsword' and required_level = 121;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 480, 'magic_attack', 497) where item_family = 'backsword' and required_level = 122;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 498, 'magic_attack', 515) where item_family = 'backsword' and required_level = 123;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 516, 'magic_attack', 533) where item_family = 'backsword' and required_level = 124;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 535, 'magic_attack', 553) where item_family = 'backsword' and required_level = 125;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 555, 'magic_attack', 573) where item_family = 'backsword' and required_level = 126;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 575, 'magic_attack', 594) where item_family = 'backsword' and required_level = 127;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 597, 'magic_attack', 615) where item_family = 'backsword' and required_level = 128;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 619, 'magic_attack', 637) where item_family = 'backsword' and required_level = 129;
update public.item_templates set base_stats = jsonb_build_object('physical_attack', 641, 'magic_attack', 660) where item_family = 'backsword' and required_level = 130;

-- Bracelet (recompounded tail only, required_level 117/122/127; 15-115 untouched)
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 181) where item_family = 'bracelet' and required_level = 117;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 208) where item_family = 'bracelet' and required_level = 122;
update public.item_templates set base_stats = jsonb_build_object('magic_attack', 239) where item_family = 'bracelet' and required_level = 127;

-- Zone Boss's own magic-defense mirror (20261214020000_zone_boss_magic_defense_baseline_fix.sql)
create or replace function public.zone_boss_magic_defense_base(p_level integer)
returns integer
language plpgsql
immutable
as $$
declare
  anchors integer[][] := array[
    array[1,7], array[5,25], array[10,30], array[15,68], array[20,103],
    array[25,143], array[30,172], array[35,213], array[40,257], array[45,312],
    array[50,350], array[55,406], array[60,439], array[65,502], array[70,540],
    array[75,634], array[80,675], array[85,773], array[90,822], array[95,943],
    array[100,993], array[105,1135], array[110,1188], array[115,1312],
    array[120,1539], array[125,1740], array[130,1976]
  ];
  v_level integer := least(greatest(p_level, anchors[1][1]), anchors[array_length(anchors,1)][1]);
  v_prev_level integer;
  v_prev_value integer;
  v_anchor_level integer;
  v_anchor_value integer;
  v_t numeric;
begin
  for i in 1..array_length(anchors,1) loop
    v_anchor_level := anchors[i][1];
    v_anchor_value := anchors[i][2];

    if v_level = v_anchor_level then
      return v_anchor_value;
    end if;

    if v_level < v_anchor_level then
      v_prev_level := anchors[i-1][1];
      v_prev_value := anchors[i-1][2];
      v_t := (v_level - v_prev_level)::numeric / (v_anchor_level - v_prev_level);
      return round(v_prev_value + (v_anchor_value - v_prev_value) * v_t);
    end if;
  end loop;

  return anchors[array_length(anchors,1)][2];
end;
$$;

-- One-time correction so any currently-active Zone Boss spawn picks up the
-- new baseline immediately (mirrors the same one-time-correction step
-- 20261214020000 itself used).
update public.world_boss_spawns s
set
  magic_defense = case when cat.defense_profile = 'physical'
    then round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 1.3)::integer
    else round(public.zone_boss_magic_defense_base(cat.zone_top_level) * 3.5)::integer
  end
from public.zone_boss_catalog() cat
where cat.boss_id = s.boss_id and s.status = 'active';

commit;
