-- Private Channel events: attribute rows to related Solana wallet addresses.
--
-- Built on top of 0040_private_channels.sql. Existing environments already have
-- `private_channel_events`, so this migration alters that table instead of
-- rewriting the original CREATE.

ALTER TABLE private_channel_events
    ADD COLUMN IF NOT EXISTS wallets TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_private_channel_events_wallets
    ON private_channel_events USING GIN (wallets);
