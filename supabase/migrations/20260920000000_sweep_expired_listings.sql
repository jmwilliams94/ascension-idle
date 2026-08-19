-- Auto-sweep expired Marketplace listings back to Mail (reported by the
-- user: a player's listing timed out but they never got the 2 items back).
-- Root cause: expiry was purely lazy, resolved only when the specific
-- listing was touched again by buy_marketplace_listing (a buyer trying to
-- purchase it) or end_marketplace_listing (the seller clicking Cancel on
-- My Listings). A seller who never revisits Marketplace after listing
-- something never triggers either path -- the row just sits at
-- status = 'active' with a past expires_at forever, the item excluded from
-- Inventory (isListed filter) but never mailed back either, so it looks
-- gone even though My Listings would still show it (with a stale "Expires
-- <past date>" label and a working Cancel button, if the seller happened to
-- notice and click it).
--
-- Fix: a new ownership-scoped RPC that resolves every one of the calling
-- character's own expired-but-still-active listings in one pass (same
-- mail-back logic end_marketplace_listing's expiry branch already has).
-- Called automatically by useMarketplaceStore's loadMyListings -- which is
-- already eager-loaded on every character login (GameShell) and re-run on
-- every My Listings visit -- so this now self-heals at session start
-- without requiring the seller to do anything, plus a short client-side
-- poll while the Marketplace tab is open for players mid-session. Mirrors
-- ensure_world_boss_spawn()'s "lazy trigger fired on mount" precedent
-- (CLAUDE.server-events.md) -- this project has no pg_cron sweep anywhere.
begin;

create or replace function public.sweep_expired_listings(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_listing record;
  v_swept_count integer := 0;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  for v_listing in
    select id, item_id, currency_type, item_template_id, item_quality_tier, item_level, item_composition_level
    from public.marketplace_listings
    where seller_character_id = p_character_id and status = 'active' and now() >= expires_at
    for update
  loop
    update public.marketplace_listings set status = 'expired' where id = v_listing.id;

    if v_listing.item_id is not null then
      insert into public.mail (character_id, item_id, reason, item_template_id, item_quality_tier, item_level, item_composition_level)
      values (
        p_character_id, v_listing.item_id, 'listing_expired',
        v_listing.item_template_id, v_listing.item_quality_tier, v_listing.item_level, v_listing.item_composition_level
      );
    else
      insert into public.mail (character_id, currency_type, reason) values (p_character_id, v_listing.currency_type, 'listing_expired');
    end if;

    v_swept_count := v_swept_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'swept_count', v_swept_count);
end;
$$;

grant execute on function public.sweep_expired_listings(uuid) to authenticated;

commit;
