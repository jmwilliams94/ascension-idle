-- Extends grant_starter_items to also auto-grant + auto-equip Wuxia's new
-- Level 1 "Lucky Backsword" starter (20261015000000_add_lucky_backsword.sql)
-- at character creation, mirroring Hunter's Lucky Bow precedent. Wuxia has
-- no Quiver equivalent -- its second-hand slot is a non-interactive dimmed
-- echo of Main Hand (see CLAUDE.accounts-and-classes.md), so only the
-- weapon is granted, no second item.
begin;

create or replace function public.grant_starter_items(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_already_granted boolean;
  v_quiver_id uuid;
  v_weapon_id uuid;
  v_template record;
begin
  select account_id, class into v_account_id, v_class from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_class not in ('hunter', 'wuxia') then
    return jsonb_build_object('ok', true, 'granted', false);
  end if;

  if v_class = 'hunter' then
    select exists (
      select 1 from public.item_instances ii
      join public.item_templates it on it.id = ii.template_id
      where ii.owner_id = p_character_id and it.item_family in ('quiver', 'lucky-bow')
    ) into v_already_granted;
  else
    select exists (
      select 1 from public.item_instances ii
      join public.item_templates it on it.id = ii.template_id
      where ii.owner_id = p_character_id and it.item_family = 'backsword'
    ) into v_already_granted;
  end if;

  if v_already_granted then
    return jsonb_build_object('ok', true, 'granted', false, 'error', 'already_granted');
  end if;

  if v_class = 'hunter' then
    select id, required_level into v_template from public.item_templates where name = 'Hunter''s Quiver';
    if found then
      insert into public.item_instances (template_id, owner_id, level, durability)
      values (v_template.id, p_character_id, v_template.required_level, 0)
      returning id into v_quiver_id;
    end if;

    select id, required_level, slot_type into v_template from public.item_templates where name = 'Lucky Bow';
    if found then
      insert into public.item_instances (template_id, owner_id, level, durability)
      values (v_template.id, p_character_id, v_template.required_level, coalesce(public.compute_max_durability(v_template.slot_type, v_template.required_level), 0))
      returning id into v_weapon_id;
    end if;

    update public.characters
    set equipped_quiver_id = coalesce(v_quiver_id, equipped_quiver_id),
        equipped_weapon_id = coalesce(v_weapon_id, equipped_weapon_id)
    where id = p_character_id;
  else
    select id, required_level, slot_type into v_template from public.item_templates where name = 'Lucky Backsword';
    if found then
      insert into public.item_instances (template_id, owner_id, level, durability)
      values (v_template.id, p_character_id, v_template.required_level, coalesce(public.compute_max_durability(v_template.slot_type, v_template.required_level), 0))
      returning id into v_weapon_id;
    end if;

    update public.characters
    set equipped_weapon_id = coalesce(v_weapon_id, equipped_weapon_id)
    where id = p_character_id;
  end if;

  return jsonb_build_object('ok', true, 'granted', true, 'quiver_id', v_quiver_id, 'weapon_id', v_weapon_id);
end;
$$;

commit;
