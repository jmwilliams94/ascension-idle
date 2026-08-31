// PvP duel board constants — see CLAUDE.md's plan nifty-riding-journal.
// BOARD_SIZE/ZONE_SIZE are duplicated in
// supabase/migrations/20261121000000_pvp_duel_core.sql's
// pvp_duel_apply_action (SQL can't import this file) — keep both in sync.
export const BOARD_SIZE = 9
export const ZONE_SIZE = 3
// Max valid zone_x/zone_y so the whole 3x3 zone stays on the board.
export const MAX_ZONE_ORIGIN = BOARD_SIZE - ZONE_SIZE
export const TURN_SECONDS = 15
