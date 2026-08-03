-- Phase 2b of the full internal rename pass (confirmed with the user,
-- 2026-08-03, alongside Meteor/DragonBall -> Comet/Fallen Star -- see
-- CLAUDE.md). "Warehouse" -> "Bank" was already a display-text-only rename
-- (2026-08-02); this finishes the job by renaming the one remaining live
-- internal piece that still said "warehouse" -- players.warehouse_points and
-- transfer_stone's own local variable/column reference. Everything else in
-- this system (bank_currency_item, BankSquares.tsx, etc.) was already
-- Bank-branded internally, confirmed by research before this migration was
-- written.
begin;

alter table public.players rename column warehouse_points to bank_points;
alter table public.players rename constraint players_warehouse_points_check to players_bank_points_check;

create or replace function public.transfer_stone(character_id uuid, tier integer, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stones jsonb;
  v_bank_points integer;
  v_tier_key text;
  v_owned integer;
  v_point_value integer;
  v_cost integer;
begin
  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if tier < 1 or tier > 4 or amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select bank_points into v_bank_points from public.players where id = v_account_id for update;

  v_tier_key := tier::text;
  v_point_value := (10 * (3::numeric ^ (tier - 1)))::integer;

  if direction = 'deposit' then
    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_owned < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_stones', 'owned', v_owned, 'requested', amount);
    end if;
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(v_owned - amount));
    v_bank_points := v_bank_points + amount * v_point_value;
  else
    v_cost := amount * v_point_value;
    if v_bank_points < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_bank_points);
    end if;
    v_bank_points := v_bank_points - v_cost;
    v_stones := jsonb_set(v_stones, array[v_tier_key], to_jsonb(coalesce((v_stones ->> v_tier_key)::integer, 0) + amount));
  end if;

  update public.characters set composition_stones = v_stones where id = character_id;
  update public.players set bank_points = v_bank_points where id = v_account_id;

  return jsonb_build_object('ok', true, 'stones', v_stones, 'bank_points', v_bank_points);
end;
$$;

commit;
