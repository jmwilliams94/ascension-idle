-- Two socket-related economy changes (requested by the user).
--
-- 1. Gear Score: 2-socket items are now worth 3 points instead of 2 (1 socket
-- stays worth 1) -- a deliberate non-linear jump, not a straight per-socket
-- multiplier.
--
-- 2. Salvage: unlocked sockets now add a flat AP bonus on top of the existing
-- per-quality-tier AP -- 20 AP for 1 socket, 160 AP for 2. Gems/composition/
-- enchant on the item are still never refunded, same as before.

create or replace function public.compute_item_gear_score(
  p_quality_tier text,
  p_sockets jsonb,
  p_enchant jsonb,
  p_composition_level integer
)
returns integer
language sql
immutable
as $$
  select
    (case p_quality_tier
      when 'tempered' then 1
      when 'infused' then 2
      when 'radiant' then 3
      when 'ascended' then 4
      else 0
    end)
    + (case coalesce(jsonb_array_length(coalesce(p_sockets, '[]'::jsonb)), 0)
        when 0 then 0
        when 1 then 1
        else 3
      end)
    + coalesce(p_composition_level, 0)
    + (case
        when (p_enchant ->> 'hp') is null then 0
        when (p_enchant ->> 'hp')::integer >= 200 then 3
        when (p_enchant ->> 'hp')::integer >= 100 then 2
        when (p_enchant ->> 'hp')::integer >= 1 then 1
        else 0
      end)
    + (case
        when (p_enchant ->> 'blessPct') is null then 0
        when (p_enchant ->> 'blessPct')::numeric >= 7 then 4
        when (p_enchant ->> 'blessPct')::numeric >= 5 then 3
        when (p_enchant ->> 'blessPct')::numeric >= 3 then 2
        when (p_enchant ->> 'blessPct')::numeric >= 1 then 1
        else 0
      end);
$$;

-- salvage_item -- same body as 20260930010000's version, plus the socket AP
-- bonus. Body otherwise unchanged.
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
  v_sockets jsonb;
  v_locked boolean;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select owner_id, quality_tier, coalesce(sockets, '[]'::jsonb), locked
  into v_character_id, v_quality_tier, v_sockets, v_locked
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

  v_ap_gained := v_ap_gained + case jsonb_array_length(v_sockets)
    when 0 then 0
    when 1 then 20
    else 160
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
