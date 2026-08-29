-- Wuxia previously started with no skill equipped at all (equipped_skill_id
-- null) despite Thunder being usable from level 1 -- a new Wuxia had no
-- reason to know skills existed unless they found the Skills tab themselves,
-- and (per the 2026-11 physical/magic damage split, CLAUDE.combat-and-loot.md)
-- would just deal plain physical damage with their starter Backsword until
-- they did. Also had no Mana potions to fall back on the moment they *did*
-- equip Thunder and started spending MP with no way to restore it short of
-- a Shop trip. Mirrors Hunter's existing "auto-equip a starter weapon+quiver"
-- precedent in grant_starter_items.
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
    set equipped_weapon_id = coalesce(v_weapon_id, equipped_weapon_id),
        equipped_skill_id = coalesce(equipped_skill_id, 'thunder')
    where id = p_character_id;

    insert into public.potion_stacks (character_id, potion_type, count)
    values (p_character_id, 'mossglow_tonic', 10);
  end if;

  return jsonb_build_object('ok', true, 'granted', true, 'quiver_id', v_quiver_id, 'weapon_id', v_weapon_id);
end;
$$;

-- Backfill existing Wuxia characters created before this fix — mirrors the
-- same defaults a fresh grant_starter_items call would now produce, since
-- there's no reason an already-playing Wuxia should stay stuck skill-less
-- and potion-less until they re-roll a new character.
update public.characters
set equipped_skill_id = 'thunder'
where class = 'wuxia' and equipped_skill_id is null;

insert into public.potion_stacks (character_id, potion_type, count)
select c.id, 'mossglow_tonic', 10
from public.characters c
where c.class = 'wuxia'
  and not exists (
    select 1 from public.potion_stacks p
    where p.character_id = c.id and p.potion_type = 'mossglow_tonic'
  );

commit;
