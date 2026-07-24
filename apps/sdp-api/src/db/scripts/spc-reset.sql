-- Destructively reset all Private Channels (SPC) tables + their schema_migrations
-- rows. Used to re-apply the SPC migrations after the greenfield-baseline squashes
-- of 0025/0027 (instance auth + verified-wallets). Non-SPC data (orgs, users,
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

DELETE FROM schema_migrations
 WHERE version ~ '^00(2[5-9]|3[0-1])_private_channel';
