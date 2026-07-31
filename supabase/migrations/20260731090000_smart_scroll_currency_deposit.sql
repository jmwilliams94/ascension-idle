-- Bug fix, reported by the user (2026-07-31): depositing Meteors/DragonBalls
-- into the account Bank via transfer_currency only ever checked
-- meteor_count/dragonball_count (loose units) -- a player holding, say, 1
-- DragonBall Scroll (worth 10) and 0 loose DragonBalls couldn't deposit 10,
-- even though they clearly had the value for it, since the deposit never
-- considered dragonball_scroll_count at all.
--
-- Fix: for Meteors/DragonBalls specifically (not Gold, which has no Scroll
-- concept), a deposit now draws on bundled Scrolls too when loose units
-- alone aren't enough -- auto-unbundling exactly as many Scrolls as needed,
-- atomically, in the same transaction as the deposit itself. Any remainder
-- (0-9 units) from a partially-consumed Scroll is left as loose units, never
-- wasted. Withdraw direction (Bank -> character) is unchanged -- it only
-- ever grants loose units, never Scrolls, so there's nothing to unbundle
-- there.
begin;

create or replace function public.transfer_currency(character_id uuid, currency text, amount integer, direction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_balance integer;
  v_bank_balance integer;
  v_scroll_count integer;
  v_scrolls_needed integer;
begin
  if currency not in ('gold', 'meteors', 'dragonballs') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if direction not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'invalid_direction');
  end if;

  if amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select account_id into v_account_id
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  perform 1 from public.players where id = v_account_id for update;

  if currency = 'gold' then
    select gold into v_character_balance from public.characters where id = character_id;
    select bank_gold into v_bank_balance from public.players where id = v_account_id;
  elsif currency = 'meteors' then
    select meteor_count, meteor_scroll_count into v_character_balance, v_scroll_count
    from public.characters where id = character_id;
    select bank_meteors into v_bank_balance from public.players where id = v_account_id;
  else
    select dragonball_count, dragonball_scroll_count into v_character_balance, v_scroll_count
    from public.characters where id = character_id;
    select bank_dragonballs into v_bank_balance from public.players where id = v_account_id;
  end if;

  if direction = 'deposit' then
    if currency = 'gold' then
      if v_character_balance < amount then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;
      v_character_balance := v_character_balance - amount;
    else
      if amount > v_character_balance + v_scroll_count * 10 then
        return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
      end if;

      v_scrolls_needed := greatest(0, ceil((amount - v_character_balance) / 10.0))::integer;
      v_scroll_count := v_scroll_count - v_scrolls_needed;
      v_character_balance := v_character_balance + v_scrolls_needed * 10 - amount;
    end if;
    v_bank_balance := v_bank_balance + amount;
  else
    if v_bank_balance < amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_balance');
    end if;
    v_bank_balance := v_bank_balance - amount;
    v_character_balance := v_character_balance + amount;
  end if;

  if currency = 'gold' then
    update public.characters set gold = v_character_balance where id = character_id;
    update public.players set bank_gold = v_bank_balance where id = v_account_id;
  elsif currency = 'meteors' then
    update public.characters
    set meteor_count = v_character_balance, meteor_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_meteors = v_bank_balance where id = v_account_id;
  else
    update public.characters
    set dragonball_count = v_character_balance, dragonball_scroll_count = v_scroll_count
    where id = character_id;
    update public.players set bank_dragonballs = v_bank_balance where id = v_account_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'character_balance', v_character_balance,
    'bank_balance', v_bank_balance,
    'character_scroll_count', v_scroll_count
  );
end;
$$;

commit;
