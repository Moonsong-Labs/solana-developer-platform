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

-- Matched by name rather than version number, so every SPC migration row is caught
-- regardless of numbering. Any row left behind makes the re-migrate a no-op and the
-- tables dropped above are never recreated.
DELETE FROM schema_migrations
 WHERE version ~ '_private_channel';
