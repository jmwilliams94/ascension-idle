-- Wuxia's gear catalog, starter weapon grant, and skill system are all live
-- (see CLAUDE.accounts-and-classes.md) but character creation still gated it
-- behind unlocked_classes, which only ever defaulted to ['hunter'] with no
-- mechanism to add to it. Makes Wuxia selectable for everyone: backfill
-- existing accounts and change the default for new ones. Twin-soul/
-- Juggernaut stay locked (their gear catalogs are prep-only, not playable).
begin;

alter table public.players
  alter column unlocked_classes set default array['hunter', 'wuxia'];

update public.players
set unlocked_classes = array_append(unlocked_classes, 'wuxia')
where not ('wuxia' = any(unlocked_classes));

commit;
