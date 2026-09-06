-- Fix: 20261214030000_remove_socket_salvage_ap_bonus.sql's own header said
-- it was removing the socket AP bonus "for 1/2-socket weapons", but its SQL
-- body dropped the bonus for every slot_type -- there was never a slot_type
-- filter in either that migration or the one that added the bonus
-- (20261009000000_socket_gear_score_and_salvage_bonus.sql), so salvaging any
-- socketed armor (ring/necklace/boots/hat/coat -- including Wuxia's
-- Bracelet, slot_type 'ring') silently lost the bonus too. Reported by the
-- user (2026-09-06): "We had the bonus removed from weapons but looks like
-- it's either not applying to Wuxia gear or is just no longer present at
-- all." Restores the 20/160 AP bonus (1/2 sockets) for every socketed
-- slot_type except weapon.
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
  v_slot_type text;
  v_sockets jsonb;
  v_locked boolean;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select ii.owner_id, ii.quality_tier, coalesce(ii.sockets, '[]'::jsonb), ii.locked, it.slot_type
  into v_character_id, v_quality_tier, v_sockets, v_locked, v_slot_type
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = item_id
  for update of ii;

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

  if v_slot_type <> 'weapon' then
    v_ap_gained := v_ap_gained + case jsonb_array_length(v_sockets)
      when 0 then 0
      when 1 then 20
      else 160
    end;
  end if;

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
