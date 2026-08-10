-- Global chat (2026-08-18, requested by the user) -- a new chat bubble sits
-- next to the Players Online indicator and GlobalAnnouncementTicker in the
-- top HUD strip. Deliberately a *separate* table from global_announcements
-- rather than folding chat into it: the announcement ticker/history dropdown
-- are meant to keep showing only real system events (armor-socket procs,
-- Lucky Lad rare wins), not get diluted by ordinary player chat volume. The
-- chat overlay itself merges both tables client-side into one combined feed
-- (see ChatOverlay.tsx) so players can talk about what the ticker just
-- announced -- CLAUDE.md's Global Activity section covers the existing
-- 'global-activity' Realtime channel this reuses.
begin;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  account_id uuid not null references auth.users (id) on delete cascade,
  character_name text not null,
  message text not null,
  constraint chat_messages_message_length check (char_length(message) between 1 and 280)
);

alter table public.chat_messages enable row level security;

-- Public feed, same shape as global_announcements' own policy -- every
-- authenticated account sees every message, not scoped to their own
-- characters.
do $$ begin
  create policy "Chat messages are publicly viewable"
    on public.chat_messages for select
    using (true);
exception when duplicate_object then null;
end $$;

-- No insert grant -- every row goes through send_chat_message below, which
-- verifies the sending character is actually owned by the caller and
-- snapshots its real name server-side (same reasoning as the marketplace
-- listing's seller_character_name snapshot -- don't trust a client-supplied
-- display name for something shown to every other player).
grant select on public.chat_messages to authenticated;

-- Required for Realtime's Postgres Changes to push INSERTs live -- without
-- this, only direct SELECT polling would ever see new messages.
alter publication supabase_realtime add table public.chat_messages;

-- ============================================================================
-- send_chat_message -- SECURITY DEFINER so character ownership + the real
-- character name are verified/snapshotted server-side, not trusted from the
-- client. A 1-second per-account cooldown guards against a single client
-- flooding every subscriber's realtime feed (deliberately light -- this is
-- flavor-text chat, not a currency system, so no need for anything heavier).
-- ============================================================================
create or replace function public.send_chat_message(p_character_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_trimmed text;
  v_last_sent_at timestamptz;
  v_id uuid;
  v_created_at timestamptz;
begin
  v_trimmed := trim(p_message);

  if v_trimmed = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_message');
  end if;

  if char_length(v_trimmed) > 280 then
    return jsonb_build_object('ok', false, 'error', 'message_too_long');
  end if;

  select account_id, name into v_account_id, v_character_name
  from public.characters
  where id = p_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select max(created_at) into v_last_sent_at
  from public.chat_messages
  where account_id = v_account_id;

  if v_last_sent_at is not null and now() - v_last_sent_at < interval '1 second' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.chat_messages (account_id, character_name, message)
  values (v_account_id, v_character_name, v_trimmed)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object('ok', true, 'id', v_id, 'created_at', v_created_at);
end;
$$;

revoke all on function public.send_chat_message(uuid, text) from public;
grant execute on function public.send_chat_message(uuid, text) to authenticated;

commit;
