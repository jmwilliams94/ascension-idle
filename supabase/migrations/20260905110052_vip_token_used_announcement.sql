-- Global announcement whenever a VIP Token is redeemed (use_vip_token),
-- regardless of how the token was acquired (Lucky Lad win, Admin Mail grant,
-- or Stripe purchase -- all funnel through this one redeem RPC). Fires on
-- every successful redemption, not just the first time a character becomes
-- VIP -- VIP Token is already hyper-rare (weight 0.02 in pick_lucky_reward),
-- same precedent as every other lucky_* hyper-rare kind that always announces.
-- Full-body copy of use_vip_token from 20260930120000_vip_token.sql, only the
-- new insert added; already security definer so no new grant is needed (see
-- CLAUDE.md's "New Supabase tables need explicit grants" gotcha -- this
-- writer was already trusted).
create or replace function public.use_vip_token(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_vip_token_count integer;
  v_vip_expires_at timestamptz;
  v_new_expires_at timestamptz;
begin
  select account_id, name, vip_token_count, vip_expires_at
  into v_account_id, v_character_name, v_vip_token_count, v_vip_expires_at
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if coalesce(v_vip_token_count, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_tokens');
  end if;

  v_new_expires_at := greatest(coalesce(v_vip_expires_at, now()), now()) + interval '30 days';

  update public.characters
  set vip_token_count = vip_token_count - 1,
      vip_expires_at = v_new_expires_at
  where id = p_character_id
  returning vip_token_count into v_vip_token_count;

  insert into public.global_announcements (kind, character_name, message)
  values ('vip_token_used', v_character_name, v_character_name || ' became a VIP!');

  return jsonb_build_object('ok', true, 'vip_token_count', v_vip_token_count, 'vip_expires_at', v_new_expires_at);
end;
$$;

revoke all on function public.use_vip_token(uuid) from public;
grant execute on function public.use_vip_token(uuid) to authenticated;
