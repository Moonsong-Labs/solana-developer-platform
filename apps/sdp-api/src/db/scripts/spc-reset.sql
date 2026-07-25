-- Destructively reset all Private Channels (SPC) tables + their schema_migrations
-- rows, so the SPC migration re-applies from scratch. Non-SPC data (orgs, users,
-- projects, api_keys, wallets, payments, etc.) is untouched.
--
-- Run via: pnpm --filter @sdp/api db:spc:reset:local && pnpm --filter @sdp/api db:migrate:local

DROP TABLE IF EXISTS private_channel_verified_wallets CASCADE;
DROP TABLE IF EXISTS private_channel_memberships CASCADE;
DROP TABLE IF EXISTS private_channel_users CASCADE;
DROP TABLE IF EXISTS private_channel_events CASCADE;
DROP TABLE IF EXISTS private_channel_withdrawals CASCADE;
DROP TABLE IF EXISTS private_channel_deposits CASCADE;
DROP TABLE IF EXISTS private_channels CASCADE;
DROP TABLE IF EXISTS private_channel_instances CASCADE;

-- Matches on the name, not a number range: the schema shipped as seven migrations
-- (0025-0031) before being folded into one (0036), and a database built before the
-- fold still carries the old rows. Both have to go or the re-migrate is skipped and
-- the tables above are never recreated.
DELETE FROM schema_migrations
 WHERE version ~ '_private_channel';
