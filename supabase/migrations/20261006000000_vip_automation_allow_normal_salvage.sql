-- Allow 'normal' as a valid autoSalvage.minTier — VIP players can now opt
-- into auto-salvaging Normal-quality drops too, not just Tempered+. Same
-- signature as the original set_vip_automation_settings (20261001000000), so
-- create or replace is safe here (no ambiguous-overload risk — see
-- CLAUDE.md's "changing a SQL function's argument list" gotcha, which
-- doesn't apply since the arg list is unchanged).
begin;

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
      'minTier', case when p_settings->'autoSalvage'->>'minTier' in ('normal', 'tempered', 'infused', 'radiant', 'ascended')
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

commit;
