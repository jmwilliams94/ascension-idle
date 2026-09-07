-- First-login Terms & Conditions / Privacy Policy acceptance gate. Stores which
-- legal doc version (LEGAL_VERSION in src/components/legal/legalShared.tsx) the
-- player last accepted, not just a boolean -- lets a future ToS/Privacy rewrite
-- force one re-prompt (bump LEGAL_VERSION) without needing another migration.
-- Null means never accepted: true for every row that exists today, since no
-- acceptance flow existed before this, so every existing account (not just new
-- signups) sees the prompt once on their next login.
alter table public.players
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_at timestamptz;
