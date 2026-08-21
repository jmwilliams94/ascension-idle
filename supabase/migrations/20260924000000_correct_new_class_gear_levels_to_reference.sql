-- Cap/Robe/Bag/Coronet/Mail/Helmet/Armor/Shield were originally seeded on a
-- generic 7/17/27/37/45/52/67/82/97/112/120/125/130 ladder (mirroring
-- Hunter's own Ring/Necklace breakpoints, per 20260909000000/20260911000000/
-- 20260912000000's own comments) instead of each family's real Conquer
-- Online level, despite reference/conquer-items/{caps,robes,bags,coronets,
-- mails,helmets,armors,shields}.md already documenting the real numbers.
-- Confirmed against the live source (co.99.com) directly this pass, not
-- just the local reference docs -- e.g. no level-7 cap exists on the source
-- page at all; the real first tier is level 15.
--
-- Bracelet is a separate case: its own ladder (1/10/20.../126, 15 tiers)
-- never matched the generic pattern above, but per the user it should still
-- collapse to reference/conquer-items/bracelets.md's real 14 tiers (also
-- confirmed against the live source) -- the level-1 'Twine Bracelet' tier
-- is dropped since the real Conquer bracelet chain has no equivalent
-- sub-15 tier, and every remaining row shifts onto its real level.
--
-- Safe to run as a same-value relabel: character creation only allows
-- Hunter today (Twin-soul/Wuxia/Juggernaut are locked, per
-- CLAUDE.accounts-and-classes.md), so no live character can hold, have
-- equipped, or have listed/mailed any of these item rows yet.
--
-- Every UPDATE here is a single-row exact-match (item_family + old
-- required_level), and no family's new level value collides with any of
-- its own other old level values, so statement order within a family does
-- not matter.

begin;

  -- cap (Wuxia hat) -- reference/conquer-items/caps.md
  update public.item_templates set required_level = 15 where item_family = 'cap' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'cap' and required_level = 17;
  update public.item_templates set required_level = 47 where item_family = 'cap' and required_level = 45;
  update public.item_templates set required_level = 121 where item_family = 'cap' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'cap' and required_level = 130;

  -- robe (Wuxia coat) -- reference/conquer-items/robes.md
  update public.item_templates set required_level = 15 where item_family = 'robe' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'robe' and required_level = 17;
  update public.item_templates set required_level = 32 where item_family = 'robe' and required_level = 27;
  update public.item_templates set required_level = 40 where item_family = 'robe' and required_level = 37;
  update public.item_templates set required_level = 47 where item_family = 'robe' and required_level = 45;
  update public.item_templates set required_level = 57 where item_family = 'robe' and required_level = 52;
  update public.item_templates set required_level = 70 where item_family = 'robe' and required_level = 67;
  update public.item_templates set required_level = 87 where item_family = 'robe' and required_level = 82;
  update public.item_templates set required_level = 100 where item_family = 'robe' and required_level = 97;
  update public.item_templates set required_level = 115 where item_family = 'robe' and required_level = 112;
  update public.item_templates set required_level = 121 where item_family = 'robe' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'robe' and required_level = 130;

  -- bag (Wuxia necklace) -- reference/conquer-items/bags.md (already correct
  -- through level 112; only the tail three tiers were off)
  update public.item_templates set required_level = 116 where item_family = 'bag' and required_level = 120;
  update public.item_templates set required_level = 121 where item_family = 'bag' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'bag' and required_level = 130;

  -- coronet (Twin-soul hat) -- reference/conquer-items/coronets.md
  update public.item_templates set required_level = 15 where item_family = 'coronet' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'coronet' and required_level = 17;
  update public.item_templates set required_level = 47 where item_family = 'coronet' and required_level = 45;
  update public.item_templates set required_level = 121 where item_family = 'coronet' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'coronet' and required_level = 130;

  -- mail (Twin-soul coat, displays as "X Armor") -- reference/conquer-items/mails.md
  update public.item_templates set required_level = 15 where item_family = 'mail' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'mail' and required_level = 17;
  update public.item_templates set required_level = 32 where item_family = 'mail' and required_level = 27;
  update public.item_templates set required_level = 40 where item_family = 'mail' and required_level = 37;
  update public.item_templates set required_level = 47 where item_family = 'mail' and required_level = 45;
  update public.item_templates set required_level = 57 where item_family = 'mail' and required_level = 52;
  update public.item_templates set required_level = 70 where item_family = 'mail' and required_level = 67;
  update public.item_templates set required_level = 87 where item_family = 'mail' and required_level = 82;
  update public.item_templates set required_level = 100 where item_family = 'mail' and required_level = 97;
  update public.item_templates set required_level = 110 where item_family = 'mail' and required_level = 112;
  update public.item_templates set required_level = 121 where item_family = 'mail' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'mail' and required_level = 130;

  -- helmet (Juggernaut hat) -- reference/conquer-items/helmets.md
  update public.item_templates set required_level = 15 where item_family = 'helmet' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'helmet' and required_level = 17;
  update public.item_templates set required_level = 47 where item_family = 'helmet' and required_level = 45;
  update public.item_templates set required_level = 121 where item_family = 'helmet' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'helmet' and required_level = 130;

  -- armor (Juggernaut coat) -- reference/conquer-items/armors.md (Oxhide
  -- Armor onward; the source's own sub-15 Coat/Dress tiers have no
  -- equivalent here)
  update public.item_templates set required_level = 15 where item_family = 'armor' and required_level = 7;
  update public.item_templates set required_level = 22 where item_family = 'armor' and required_level = 17;
  update public.item_templates set required_level = 32 where item_family = 'armor' and required_level = 27;
  update public.item_templates set required_level = 40 where item_family = 'armor' and required_level = 37;
  update public.item_templates set required_level = 47 where item_family = 'armor' and required_level = 45;
  update public.item_templates set required_level = 57 where item_family = 'armor' and required_level = 52;
  update public.item_templates set required_level = 70 where item_family = 'armor' and required_level = 67;
  update public.item_templates set required_level = 87 where item_family = 'armor' and required_level = 82;
  update public.item_templates set required_level = 100 where item_family = 'armor' and required_level = 97;
  update public.item_templates set required_level = 110 where item_family = 'armor' and required_level = 112;
  update public.item_templates set required_level = 121 where item_family = 'armor' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'armor' and required_level = 130;

  -- shield (Juggernaut off-hand) -- reference/conquer-items/shields.md (the
  -- most divergent case: real shields start at level 40, not 7)
  update public.item_templates set required_level = 40 where item_family = 'shield' and required_level = 7;
  update public.item_templates set required_level = 47 where item_family = 'shield' and required_level = 17;
  update public.item_templates set required_level = 55 where item_family = 'shield' and required_level = 27;
  update public.item_templates set required_level = 62 where item_family = 'shield' and required_level = 37;
  update public.item_templates set required_level = 70 where item_family = 'shield' and required_level = 45;
  update public.item_templates set required_level = 77 where item_family = 'shield' and required_level = 52;
  update public.item_templates set required_level = 85 where item_family = 'shield' and required_level = 67;
  update public.item_templates set required_level = 92 where item_family = 'shield' and required_level = 82;
  update public.item_templates set required_level = 100 where item_family = 'shield' and required_level = 97;
  update public.item_templates set required_level = 110 where item_family = 'shield' and required_level = 112;
  update public.item_templates set required_level = 121 where item_family = 'shield' and required_level = 125;
  update public.item_templates set required_level = 126 where item_family = 'shield' and required_level = 130;

  -- bracelet (Wuxia ring) -- reference/conquer-items/bracelets.md, 14 real
  -- tiers not 15; drop the level-1 starter (no real-reference equivalent)
  -- and shift every remaining tier onto its real level.
  delete from public.item_templates where item_family = 'bracelet' and required_level = 1;
  update public.item_templates set required_level = 15  where item_family = 'bracelet' and required_level = 10;
  update public.item_templates set required_level = 25  where item_family = 'bracelet' and required_level = 20;
  update public.item_templates set required_level = 35  where item_family = 'bracelet' and required_level = 30;
  update public.item_templates set required_level = 45  where item_family = 'bracelet' and required_level = 40;
  update public.item_templates set required_level = 55  where item_family = 'bracelet' and required_level = 50;
  update public.item_templates set required_level = 65  where item_family = 'bracelet' and required_level = 60;
  update public.item_templates set required_level = 75  where item_family = 'bracelet' and required_level = 70;
  update public.item_templates set required_level = 85  where item_family = 'bracelet' and required_level = 80;
  update public.item_templates set required_level = 95  where item_family = 'bracelet' and required_level = 90;
  update public.item_templates set required_level = 105 where item_family = 'bracelet' and required_level = 100;
  update public.item_templates set required_level = 115 where item_family = 'bracelet' and required_level = 110;
  update public.item_templates set required_level = 117 where item_family = 'bracelet' and required_level = 116;
  update public.item_templates set required_level = 122 where item_family = 'bracelet' and required_level = 121;
  update public.item_templates set required_level = 127 where item_family = 'bracelet' and required_level = 126;

commit;
