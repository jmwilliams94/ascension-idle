-- One-off: Wuxard (Wuxia) accidentally attacked the live Zone Boss (Glacius)
-- after the Wuxia/Hunter damage-scale fixes, and wants to switch to his
-- Hunter (Huntard) for the rest of this spawn. Zone Boss's account-wide
-- exclusivity (apply_world_boss_attack) locks an account to whichever of its
-- characters has attempts on the current spawn -- with only Wuxard having a
-- participant row, Huntard's attacks are refused (`other_character_active`)
-- until Wuxard's row is gone. Deleting it (rather than zeroing total_damage)
-- is required: a zero-damage row with attempts_used > 0 still counts as the
-- account's sole qualifying participant and would keep blocking Huntard.
begin;

delete from public.world_boss_participants
where spawn_id = (select current_spawn_id from public.world_boss_state where id = 1)
  and character_id = (select id from public.characters where name = 'Wuxard');

commit;
