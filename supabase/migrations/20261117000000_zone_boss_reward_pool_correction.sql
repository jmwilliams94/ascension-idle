-- One-time compensation for the Zone Boss proportional-rewards migration
-- (20261115000000) landing while a spawn was already in-window. That spawn
-- (id b9370125-04e5-466d-9822-f68b2d5c0e8f, boss mourncrow, a stale
-- pre-rotation row whose max_hp never got re-rolled through
-- ensure_world_boss_spawn) got backfilled with an empty reward_pool by the
-- ADD COLUMN ... DEFAULT, so its payout only sent the flat 1-Lottery-Ticket
-- participation reward to everyone, including the 34%-damage leader.
--
-- Credits each of that spawn's participants the pool share they should have
-- received: level-25 pool (lottery_ticket 13 / fallen_star 3 / comet_scroll 3,
-- from zone_boss_reward_pool_for_level(25)) split by their damage share of
-- the spawn's max_hp (50000), same formula as the fixed payout code. Shares
-- that round to 0 (Wuxee, Ethan) are omitted, matching the real payout loop's
-- own `if v_share > 0` guard.
begin;

with batch as (select gen_random_uuid() as id),
corrections(character_id, currency_type, amount) as (
  values
    ('a5543555-9f65-499d-a053-066b6a17dbd7'::uuid, 'lottery_ticket', 4),
    ('a5543555-9f65-499d-a053-066b6a17dbd7'::uuid, 'fallen_star', 1),
    ('a5543555-9f65-499d-a053-066b6a17dbd7'::uuid, 'comet_scroll', 1),
    ('1b97baa0-f1c5-4f17-990e-c817fed2175a'::uuid, 'lottery_ticket', 3),
    ('1b97baa0-f1c5-4f17-990e-c817fed2175a'::uuid, 'fallen_star', 1),
    ('1b97baa0-f1c5-4f17-990e-c817fed2175a'::uuid, 'comet_scroll', 1),
    ('4bd099d2-3906-4d29-b303-ac7eb4c85077'::uuid, 'lottery_ticket', 1)
)
insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
select
  c.character_id, c.currency_type, c.amount, 'zone_boss_reward', batch.id, 'Mourncrow',
  'Zone Boss Rewards (Correction)',
  'A migration deployed mid-fight caused this Mourncrow kill''s proportional reward pool to pay out empty. This mail credits the pool share your damage should have earned, on top of the Lottery Ticket you already received.'
from corrections c, batch;

commit;
