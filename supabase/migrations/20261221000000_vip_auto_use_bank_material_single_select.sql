-- Corrects 20261220000000_vip_forge_bank_material.sql per the user's
-- same-day follow-up: the Comet/Fallen Star auto-use toggle should be
-- single-select (only one currency active at a time), not two independent
-- booleans. Also, picking one now drives the client's Forge auto-fill
-- behavior, so "both at once" has no coherent meaning anyway. Changes
-- vip_automation_settings.autoUseBankMaterial's shape from
-- {comet: boolean, fallen_star: boolean} to a single nullable
-- 'comet' | 'fallen_star' | null. No existing character has this field set
-- yet (shipped hours earlier, same day), so no data backfill is needed.
--
-- Both functions keep their exact signatures, so plain create-or-replace is
-- safe on both (no drop needed).
begin;

-- ============================================================================
-- 1. ensure_forge_currency -- single-select read instead of a boolean lookup
--    under the old {comet, fallen_star} shape. Everything else unchanged
--    from 20261220000000_vip_forge_bank_material.sql.
-- ============================================================================
create or replace function public.ensure_forge_currency(
  p_character_id uuid,
  p_currency_type text,
  p_amount_needed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_loose integer;
  v_account_id uuid;
  v_vip_expires_at timestamptz;
  v_automation jsonb;
  v_bank_balance integer;
  v_shortfall integer;
  v_bank_used integer;
begin
  if p_currency_type not in ('comet', 'fallen_star') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  -- Step 1: same scroll-unbundling ensure_loose_currency already does.
  v_result := public.ensure_loose_currency(p_character_id, p_currency_type, p_amount_needed);
  if not (v_result ->> 'ok')::boolean then
    return v_result;
  end if;

  select account_id, vip_expires_at, vip_automation_settings,
         case when p_currency_type = 'comet' then comet_count else fallen_star_count end
  into v_account_id, v_vip_expires_at, v_automation, v_loose
  from public.characters
  where id = p_character_id;

  if v_loose >= p_amount_needed then
    return v_result;
  end if;

  -- Not VIP, or VIP but this currency isn't the one selected as the
  -- auto-use material -- fall through unchanged; the caller's own
  -- affordability check reports the ordinary "not enough" error.
  if v_account_id is null or v_vip_expires_at is null or v_vip_expires_at <= now()
     or coalesce(v_automation ->> 'autoUseBankMaterial', '') <> p_currency_type then
    return v_result;
  end if;

  v_shortfall := p_amount_needed - v_loose;

  perform 1 from public.players where id = v_account_id for update;

  if p_currency_type = 'comet' then
    select bank_comets into v_bank_balance from public.players where id = v_account_id;
  else
    select bank_fallen_stars into v_bank_balance from public.players where id = v_account_id;
  end if;

  v_bank_used := least(v_shortfall, coalesce(v_bank_balance, 0));
  if v_bank_used <= 0 then
    return v_result;
  end if;

  if p_currency_type = 'comet' then
    update public.characters set comet_count = comet_count + v_bank_used where id = p_character_id;
    update public.players set bank_comets = bank_comets - v_bank_used where id = v_account_id;
  else
    update public.characters set fallen_star_count = fallen_star_count + v_bank_used where id = p_character_id;
    update public.players set bank_fallen_stars = bank_fallen_stars - v_bank_used where id = v_account_id;
  end if;

  return v_result || jsonb_build_object('bank_used', v_bank_used);
end;
$$;

-- ============================================================================
-- 2. set_vip_automation_settings -- autoUseBankMaterial whitelisted as a
--    single nullable string instead of a nested {comet, fallen_star} object.
--    autoUsePotions stays as fixed in the previous migration.
-- ============================================================================
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
    'autoSellGear', coalesce((p_settings->>'autoSellGear')::boolean, false),
    'autoSalvage', jsonb_build_object(
      'enabled', coalesce((p_settings->'autoSalvage'->>'enabled')::boolean, false),
      'minTier', case when p_settings->'autoSalvage'->>'minTier' in ('tempered', 'infused', 'radiant', 'ascended')
                   then p_settings->'autoSalvage'->>'minTier' else 'tempered' end
    ),
    'autoBank', jsonb_build_object(
      'enabled', coalesce((p_settings->'autoBank'->>'enabled')::boolean, false),
      'minLevel', greatest(1, least(12, coalesce((p_settings->'autoBank'->>'minLevel')::integer, 1)))
    ),
    'priority', case when p_settings->>'priority' = 'salvage_first' then 'salvage_first' else 'bank_first' end,
    'autoUsePotions', jsonb_build_object(
      'hp', coalesce((p_settings->'autoUsePotions'->>'hp')::boolean, false),
      'mp', coalesce((p_settings->'autoUsePotions'->>'mp')::boolean, false)
    ),
    'autoUseBankMaterial', case when p_settings->>'autoUseBankMaterial' in ('comet', 'fallen_star')
                             then p_settings->>'autoUseBankMaterial' else null end
  );

  update public.characters set vip_automation_settings = v_clean where id = p_character_id;
  return jsonb_build_object('ok', true, 'settings', v_clean);
end;
$$;

commit;
