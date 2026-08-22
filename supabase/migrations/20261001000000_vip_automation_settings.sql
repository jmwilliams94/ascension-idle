-- VIP automation settings: the first real payoff for VIP status
-- (characters.vip_expires_at, groundwork-only since v1.107.0) — persists a
-- player's on/off toggles + thresholds for the four VIP auto-mechanics
-- (auto-sell Ore, auto-salvage quality gear, auto-bank +N gear, and priority
-- between the latter two). Auto-Forge repeat needs no persisted setting of
-- its own (session-scoped checkbox in ForgeStandardPanel).
--
-- No new RPC is needed for the automations' own actions — they replay the
-- existing sell_item/salvage_item/deposit_item_as_composition/level_upgrade
-- RPCs, all already reachable by any player manually. This migration only
-- adds a settings column + its own SECURITY DEFINER writer, since
-- 20260821000000_lock_down_direct_table_writes.sql narrowed characters'
-- authenticated UPDATE grant to an explicit column allowlist that doesn't
-- include this new column — same "RPC-only past the allowlist" precedent
-- every other characters column addition since that migration follows.
begin;

alter table public.characters
  add column vip_automation_settings jsonb not null default '{}'::jsonb;

create or replace function public.set_vip_automation_settings(p_character_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_clean jsonb;
begin
  select account_id into v_account_id from public.characters where id = p_character_id for update;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- Whitelist known keys/shapes only; anything else in p_settings is dropped.
  v_clean := jsonb_build_object(
    'autoSellOre', coalesce((p_settings->>'autoSellOre')::boolean, false),
    'autoSalvage', jsonb_build_object(
      'enabled', coalesce((p_settings->'autoSalvage'->>'enabled')::boolean, false),
      'minTier', case when p_settings->'autoSalvage'->>'minTier' in ('tempered', 'infused', 'radiant', 'ascended')
                   then p_settings->'autoSalvage'->>'minTier' else 'tempered' end
    ),
    'autoBank', jsonb_build_object(
      'enabled', coalesce((p_settings->'autoBank'->>'enabled')::boolean, false),
      'minLevel', greatest(1, least(12, coalesce((p_settings->'autoBank'->>'minLevel')::integer, 1)))
    ),
    'priority', case when p_settings->>'priority' = 'salvage_first' then 'salvage_first' else 'bank_first' end
  );

  update public.characters set vip_automation_settings = v_clean where id = p_character_id;
  return jsonb_build_object('ok', true, 'settings', v_clean);
end;
$$;

revoke all on function public.set_vip_automation_settings(uuid, jsonb) from public;
grant execute on function public.set_vip_automation_settings(uuid, jsonb) to authenticated;

commit;
