-- SPC verified wallets: a custody wallet (pubkey) a member has proven control
-- of, via the challenge → sign → verify handshake with the connected instance's
-- auth service, under that member's SPC user. This is the gate the future
-- transfer/withdraw flows check before moving money.
--
-- A member may verify many wallets, but a verification is scoped to the instance
-- it was made under and does not transfer across instances: uniqueness is
-- (user_id, instance_id, pubkey). user_id and instance_id are each globally
-- unique keys that pin the org/project, so those columns are not part of the key.

CREATE TABLE IF NOT EXISTS private_channel_verified_wallets (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    -- The private_channel_users row (SPC user) this wallet was verified under.
    user_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    verified_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES private_channel_users(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES private_channel_instances(id) ON DELETE CASCADE
);

-- One verification per (member, instance, pubkey); the same pubkey may recur
-- under another instance or member. This is the ON CONFLICT target — a re-verify
-- refreshes the row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_user_instance_pubkey
    ON private_channel_verified_wallets(user_id, instance_id, pubkey);

CREATE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_instance
    ON private_channel_verified_wallets(instance_id);

-- The per-member, per-instance listing (newest first) + the members' verified
-- count both read by (user_id, instance_id).
CREATE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_user_instance
    ON private_channel_verified_wallets(user_id, instance_id, verified_at DESC);
