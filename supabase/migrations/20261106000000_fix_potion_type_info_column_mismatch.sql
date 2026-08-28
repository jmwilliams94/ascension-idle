-- Fixes a real bug reported by the user (potion purchase failing with a
-- console 400 for both HP and MP potions): potion_type_info's `select *`
-- pulled all 4 columns from its VALUES literal (potion_type, price,
-- stack_size, required_level), but the function's own `returns table (price
-- integer, stack_size integer, required_level integer)` only declares 3 --
-- a column-count/type mismatch ("structure of query does not match function
-- result type... text does not match expected type integer in column 1")
-- that PostgREST surfaces to the client as a bare 400. Every call to
-- shop_buy_potion (both HP and MP potions share this one lookup function)
-- has been broken since this function was written -- reproduced directly by
-- simulating an authenticated call, confirmed via the exact error above.
--
-- Fix: select only the 3 declared columns, keep potion_type in the WHERE
-- filter only, matching what the return signature actually promises. Same
-- signature (input/output types unchanged) so a plain create-or-replace is
-- safe, no drop needed.
begin;

create or replace function public.potion_type_info(p_potion_type text)
returns table (price integer, stack_size integer, required_level integer)
language plpgsql
as $$
begin
  return query select t.price, t.stack_size, t.required_level from (values
    ('sprigroot_tonic', 3, 20, 1),
    ('verdant_balm', 6, 20, 20),
    ('emberleaf_draught', 12, 20, 40),
    ('ironbark_elixir', 20, 20, 60),
    ('stormroot_brew', 35, 20, 80),
    ('duskflame_panacea', 55, 20, 95),
    ('skyfire_elixir', 85, 20, 110),
    ('wyrmheart_draught', 130, 20, 125),
    ('mossglow_tonic', 3, 20, 1),
    ('whisperleaf_draught', 6, 20, 20),
    ('moonpetal_elixir', 12, 20, 40),
    ('starlight_brew', 20, 20, 60),
    ('emberwind_panacea', 35, 20, 80),
    ('nightbloom_draught', 55, 20, 95),
    ('voidglass_elixir', 85, 20, 110),
    ('astral_draught', 130, 20, 125)
  ) as t(potion_type, price, stack_size, required_level)
  where t.potion_type = p_potion_type;
end;
$$;

revoke all on function public.potion_type_info(text) from public;

commit;
