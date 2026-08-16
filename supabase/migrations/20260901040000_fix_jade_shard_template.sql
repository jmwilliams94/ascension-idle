-- Fix: 20260901020000's Jade Shard insert used `where not exists`, but a row
-- named 'Jade Shard' already existed (it's the same row originally named
-- 'Emerald', renamed by 20260901010000_promotion_rename_pass.sql) — so the
-- insert silently no-op'd and the row kept its stale required_class='hunter'/
-- required_level=70 from its Emerald-era values instead of the intended
-- null/65. Doesn't affect promote_character (looks up by name, works either
-- way) or the new kill-drop grant (also name-only lookup, class-agnostic) —
-- required_class/required_level are display-only — but corrects the record
-- to match CLAUDE.md's documented intent (any class, level-65-flavored).
begin;

update public.item_templates
set required_class = null, required_level = 65
where name = 'Jade Shard';

commit;
