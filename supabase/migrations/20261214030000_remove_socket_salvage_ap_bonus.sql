-- Removes the flat AP bonus for 1/2-socket weapons added in
-- 20261009000000_socket_gear_score_and_salvage_bonus.sql (requested by the
-- user). Salvage now pays out purely on quality tier again, regardless of
-- socket count. Gear Score's own 1/3-point socket weighting is unaffected.

create or replace function public.salvage_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_quality_tier text;
  v_locked boolean;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select owner_id, quality_tier, locked
  into v_character_id, v_quality_tier, v_locked
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'item_locked');
  end if;

  v_ap_gained := case v_quality_tier
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;
