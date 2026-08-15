-- Reduce World Boss HP from the 2,000,000 placeholder to 50,000 (requested
-- by the user, first real balance pass) — both the currently active spawn
-- (refreshed to full at the new value) and every future spawn
-- ensure_world_boss_spawn rolls.
begin;

update public.world_boss_spawns
set max_hp = 50000, current_hp = 50000
where id = (select current_spawn_id from public.world_boss_state where id = 1)
  and status = 'active';

create or replace function public.ensure_world_boss_spawn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_spawn_id uuid;
  v_status text;
  v_window_ends_at timestamptz;
  v_max_hp bigint;
  v_new_spawn_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_participant record;
  v_reward record;
  v_message text;
begin
  select current_spawn_id into v_current_spawn_id from public.world_boss_state where id = 1 for update;

  select status, window_ends_at, max_hp into v_status, v_window_ends_at, v_max_hp
  from public.world_boss_spawns where id = v_current_spawn_id;

  if v_status = 'active' and now() < v_window_ends_at then
    return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_current_spawn_id));
  end if;

  if v_status = 'active' then
    for v_participant in
      select character_id, total_damage, row_number() over (order by total_damage desc) as rn
      from public.world_boss_participants
      where spawn_id = v_current_spawn_id and (free_attempts_used + paid_attempts_used) > 0
    loop
      v_message := case v_participant.rn
        when 1 then 'You placed 1st in the World Boss fight!'
        when 2 then 'You placed 2nd in the World Boss fight!'
        when 3 then 'You placed 3rd in the World Boss fight!'
        else 'Thanks for fighting the World Boss!'
      end;

      for v_reward in select * from public.world_boss_reward_for_tier('participation') loop
        insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
        values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
      end loop;

      if v_participant.rn <= 3 then
        for v_reward in
          select * from public.world_boss_reward_for_tier(
            case v_participant.rn when 1 then 'first' when 2 then 'second' else 'third' end
          )
        loop
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (v_participant.character_id, v_reward.currency_type, v_reward.amount, 'world_boss_reward', v_batch_id, 'World Boss', 'World Boss Rewards', v_message);
        end loop;
      end if;
    end loop;

    update public.world_boss_spawns set status = 'ended', rewards_distributed_at = now() where id = v_current_spawn_id;
  end if;

  -- HP lowered to 50000 (was 2000000 placeholder), requested by the user —
  -- first real balance pass, alongside damage-roll variance and a lower
  -- BOSS_DEFENSE in supabase/functions/world-boss-attack/index.ts.
  v_max_hp := 50000;
  insert into public.world_boss_spawns (max_hp, current_hp, window_started_at, window_ends_at)
  values (v_max_hp, v_max_hp, now(), now() + (interval '1 hour' * (6 + random() * 2)))
  returning id into v_new_spawn_id;

  update public.world_boss_state set current_spawn_id = v_new_spawn_id where id = 1;

  return jsonb_build_object('ok', true, 'spawn', (select to_jsonb(s) from public.world_boss_spawns s where s.id = v_new_spawn_id));
end;
$$;

revoke all on function public.ensure_world_boss_spawn() from public;
grant execute on function public.ensure_world_boss_spawn() to authenticated;
grant execute on function public.ensure_world_boss_spawn() to service_role;

commit;
