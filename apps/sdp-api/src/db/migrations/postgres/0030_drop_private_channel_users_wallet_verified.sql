-- Drop the denormalized wallet_verified boolean on private_channel_users. The
-- verification state is derived from private_channel_verified_wallets (a member
-- can verify many wallets), so a per-member boolean was redundant and could
-- drift from the source of truth. The members UI now shows a verified-wallet
-- count computed from that table instead.

ALTER TABLE private_channel_users DROP COLUMN IF EXISTS wallet_verified;
