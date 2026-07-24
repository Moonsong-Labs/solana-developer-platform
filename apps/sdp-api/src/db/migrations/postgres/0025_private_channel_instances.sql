-- SPC connection metadata. At most one active row per project; inactive rows
-- are kept as history so a same-gateway reconnect can reuse the id. Downstream
-- tables reference private_channel_instances.id, so Delete cascades and swap
-- flows must go through Disconnect + Connect (never a raw UPDATE).

CREATE TABLE IF NOT EXISTS private_channel_instances (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,

    gateway_url TEXT NOT NULL,
    chain_rpc_url TEXT NOT NULL,
    escrow_program_id TEXT NOT NULL,
    withdraw_program_id TEXT NOT NULL,
    escrow_instance_addr TEXT NOT NULL,
    -- Auth service base URL. Required: SPC's whole member/wallet model is
    -- meaningless without auth, so the connect flow rejects an instance whose
    -- auth service can't be reached (see probeConnection).
    auth_url TEXT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT FALSE,

    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Instance identity within a project. Gateway URL is the stable key: RPC URL
-- and program IDs can be swapped underneath, but changing the gateway means
-- a different SPC deployment and thus a different instance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_instances_project_gateway
    ON private_channel_instances(project_id, gateway_url);

-- At most one active row per project. Enforced at the DB layer so a
-- concurrent double-Connect can't race past the app-layer check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_instances_project_active
    ON private_channel_instances(project_id)
    WHERE is_active = TRUE;

-- Org-wide listing (future admin views) sorted by recency.
CREATE INDEX IF NOT EXISTS idx_private_channel_instances_org_updated
    ON private_channel_instances(organization_id, updated_at DESC);
