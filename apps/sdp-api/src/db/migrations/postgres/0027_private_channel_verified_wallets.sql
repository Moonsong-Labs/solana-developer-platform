-- SPC verified wallets: a custody wallet (pubkey) that completed the
-- challenge → sign → verify handshake with the connected instance's auth
-- service, under the project's derived SPC user. This is the gate the future
-- transfer/withdraw flows check before moving money.
--
-- Wallets are reusable across projects / orgs / users, so uniqueness is scoped
-- to (organization_id, project_id, pubkey) — mirroring SPC's own
-- UNIQUE(user_id, pubkey) given the per-project SPC user — NOT global.

CREATE TABLE IF NOT EXISTS private_channel_verified_wallets (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    verified_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES private_channel_instances(id) ON DELETE CASCADE
);

-- One verification per wallet per project scope (mirrors SPC's UNIQUE(user_id, pubkey)
-- given the per-project SPC user); the same pubkey may recur under other scopes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_scope_pubkey
    ON private_channel_verified_wallets(organization_id, project_id, pubkey);

CREATE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_instance
    ON private_channel_verified_wallets(instance_id);

-- Project-scoped listing, newest first.
CREATE INDEX IF NOT EXISTS idx_private_channel_verified_wallets_project
    ON private_channel_verified_wallets(organization_id, project_id, verified_at DESC);
