-- Fix get_gear_score_leaderboard (reported by the user: "Couldn't load the
-- leaderboard"). The previous body ran a `with scored as (...), ranked as
-- (...) select ... into v_entries` statement, then a SEPARATE `select ...
-- into v_self from ranked ...` statement -- but a CTE only exists within the
-- single SQL statement it's attached to. The second statement's `from ranked`
-- referenced a relation that no longer existed, so every call raised
-- "relation \"ranked\" does not exist" and the RPC errored out entirely.
-- Fixed by computing both v_entries and v_self as two scalar subqueries
-- inside one statement, sharing one `with` clause.
create or replace function public.get_gear_score_leaderboard(
  p_character_id uuid,
  p_class text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entries jsonb;
  v_self jsonb;
begin
  with scored as (
    select c.id, c.name, c.class, c.level, public.get_character_gear_score(c.id) as gear_score
    from public.characters c
    where p_class is null or c.class = p_class
  ),
  ranked as (
    select *, rank() over (order by gear_score desc) as rnk from scored
  )
  select
    (select jsonb_agg(jsonb_build_object(
       'rank', rnk, 'character_name', name, 'class', class, 'level', level, 'gear_score', gear_score
     ) order by rnk)
     from (select * from ranked order by rnk limit p_limit) top_ranked),
    (select jsonb_build_object('rank', rnk, 'gear_score', gear_score) from ranked where id = p_character_id)
  into v_entries, v_self;

  return jsonb_build_object('ok', true, 'entries', coalesce(v_entries, '[]'::jsonb), 'self', v_self);
end;
$$;

revoke all on function public.get_gear_score_leaderboard(uuid, text, integer) from public;
grant execute on function public.get_gear_score_leaderboard(uuid, text, integer) to authenticated;
