-- Plans (2026-08-21, requested by the user) -- re-adds a public roadmap
-- list (previously "To-Do", dropped entirely in
-- 20260821030000_suggestions_replace_todo.sql when Suggestions replaced it)
-- with one addition: the admin account can drag-and-drop reorder entries,
-- not just add/remove. Every other player still sees a read-only,
-- admin-ordered list. Built on the is_admin() helper (added in
-- 20260821020000_fix_bug_reports_admin_rls.sql) from the start.
begin;

create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  content text not null check (char_length(content) between 1 and 500),
  position integer not null default 0
);

create index if not exists plan_items_position_idx on public.plan_items (position);

alter table public.plan_items enable row level security;

do $$ begin
  create policy "Plan items are publicly viewable"
    on public.plan_items for select
    using (true);
exception when duplicate_object then null;
end $$;

grant select on public.plan_items to authenticated;

create or replace function public.admin_add_plan(p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text := trim(p_content);
  v_next_position integer;
  v_new_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if v_content is null or length(v_content) = 0 then
    return jsonb_build_object('ok', false, 'error', 'content_required');
  end if;

  select coalesce(max(position), -1) + 1 into v_next_position from public.plan_items;

  insert into public.plan_items (content, position) values (v_content, v_next_position) returning id into v_new_id;
  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

revoke all on function public.admin_add_plan(text) from public;
grant execute on function public.admin_add_plan(text) to authenticated;

create or replace function public.admin_remove_plan(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  delete from public.plan_items where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_remove_plan(uuid) from public;
grant execute on function public.admin_remove_plan(uuid) to authenticated;

-- Reorders every plan item to match the exact order of p_ordered_ids
-- (position = array index). The client always passes the full current list
-- on every reorder (see usePlanStore.ts), so any id it omits just keeps its
-- old position -- never happens in practice since the client always has the
-- complete set loaded before a drag can start.
create or replace function public.admin_reorder_plans(p_ordered_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_position integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.plan_items set position = v_position where id = v_id;
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_reorder_plans(uuid[]) from public;
grant execute on function public.admin_reorder_plans(uuid[]) to authenticated;

commit;
