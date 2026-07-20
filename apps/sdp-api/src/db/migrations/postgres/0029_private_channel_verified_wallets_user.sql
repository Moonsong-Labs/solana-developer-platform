-- Link each verified wallet to the private_channel_users row (the SPC user) it
-- was verified under. Verification is now per invited member: a member logs in
-- as their own SPC user and signs the challenge, so the SDP mirror is scoped to
-- that user — mirroring SPC's own UNIQUE(user_id, pubkey).
--
-- The verify write path did not exist before this migration, so the table
-- carried no real verifications; there is nothing to backfill. Any stray rows
-- predate the user link and are meaningless, so they are dropped.

ALTER TABLE private_channel_verified_wallets
    ADD COLUMN IF NOT EXISTS user_id TEXT;

DELETE FROM private_channel_verified_wallets WHERE user_id IS NULL;

ALTER TABLE private_channel_verified_wallets
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE private_channel_verified_wallets
    ADD CONSTRAINT private_channel_verified_wallets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES private_channel_users(id) ON DELETE CASCADE;

-- Re-scope uniqueness from (org, project, pubkey) to include user_id: the same
-- custody wallet may be verified by multiple invited members in a project.
DROP INDEX IF EXISTS idx_private_channel_verified_wallets_scope_pubkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_user_scope_pubkey
    ON private_channel_verified_wallets(organization_id, project_id, user_id, pubkey);

CREATE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_user
    ON private_channel_verified_wallets(user_id);
