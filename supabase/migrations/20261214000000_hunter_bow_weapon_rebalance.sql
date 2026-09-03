-- Hunter Bow weapon line rebalance (v1.130.0).
--
-- Root cause: comparing a Wuxia's Backsword (magic_attack) against a
-- Hunter's Bow (physical_attack) at matching required_level showed the
-- Backsword line running ~5-9x higher than the Bow line at every tier, on
-- top of Wuxia's own spirit attribute anchor (265 at L130) already
-- outscaling Hunter's strength anchor (84 at L130) by ~3x. Net effect: a
-- geared Wuxia's total magic output could be 6x+ a same-tier Hunter's
-- physical output against any target that shares one flat defense value
-- (every normal monster) — confirmed via live combat log (Zone Boss
-- Nyxharrow: a L122 Wuxia averaged ~4,515 dmg/hit vs. a same-account L130
-- Hunter's formula-projected ~1,650 dmg/hit).
--
-- Fix: raise each Bow tier's physical_attack so that
-- (hunter_strength(L)*2 + bow_physical_attack(L)) equals
-- (wuxia_spirit(L)*2 + backsword_magic_attack(L)) at that tier's
-- required_level — i.e. total attribute+weapon output matches, not just the
-- weapon's own base_stats number. This deliberately preserves current
-- Wuxia/magic damage output against normal monsters exactly as-is (the
-- user explicitly wants that kept) while bringing Hunter up to the same
-- scale instead of nerfing Wuxia down. dexterity is untouched.
--
-- See also 20261214010000 (world-boss-attack specialty damage penalty,
-- code-only change in the Edge Function, no migration) — that's the
-- companion fix for Zone Boss specifically, since a flat defense bump alone
-- can't meaningfully rein in an endgame-geared attacker's damage cap.

begin;

update public.item_templates
set base_stats = jsonb_set(
  base_stats,
  '{physical_attack}',
  to_jsonb(
    case required_level
      when 8 then 20
      when 15 then 37
      when 20 then 59
      when 25 then 80
      when 30 then 98
      when 35 then 117
      when 40 then 145
      when 45 then 169
      when 50 then 193
      when 55 then 216
      when 60 then 239
      when 65 then 263
      when 70 then 292
      when 75 then 329
      when 80 then 363
      when 85 then 402
      when 90 then 442
      when 95 then 488
      when 100 then 535
      when 105 then 585
      when 110 then 638
      when 115 then 734
      when 120 then 815
      when 121 then 886
      when 122 then 958
      when 123 then 1029
      when 124 then 1101
      when 125 then 1172
      when 126 then 1243
      when 127 then 1315
      when 128 then 1386
      when 129 then 1458
      when 130 then 1529
    end
  )
)
where item_family = 'bow';

commit;
