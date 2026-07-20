-- Private Channels deposits: escrow deposit intents that move USDC from a custody
-- wallet into the instance's escrow on-chain, then get credited into the channel.
-- Lifecycle: prepared -> submitted -> confirmed -> credited (or failed). Amounts
-- are decimal strings (never numeric/float). `baseline_credited` is the recipient's
-- channel balance captured at intent time.
--
-- Deposits are FINANCIAL/AUDIT records: `instance_id` is denormalized with NO FK
-- (like private_channel_events) so a deposit SURVIVES instance deletion; the
-- delete handler rejects deletion while non-terminal deposits exist. The
-- reconciliation endpoints (gateway/chain RPC/escrow) are SNAPSHOTTED on the row
-- so a later reconnect that changes the instance config can't move the chain a
-- pending deposit is reconciled against.

CREATE TABLE IF NOT EXISTS private_channel_deposits (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    depositor TEXT NOT NULL,
    recipient TEXT NOT NULL,
    mint TEXT NOT NULL,
    amount TEXT NOT NULL,
    baseline_credited TEXT NOT NULL DEFAULT '0',
    -- Instance config snapshotted at intent time (immutable reconciliation context).
    gateway_url TEXT NOT NULL DEFAULT '',
    chain_rpc_url TEXT NOT NULL DEFAULT '',
    escrow_program_id TEXT NOT NULL DEFAULT '',
    escrow_instance_addr TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'prepared',
    signature TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    -- org/project cascade with their parents; instance_id is intentionally NOT a
    -- FK so the deposit record outlives the instance (financial history).
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

    CONSTRAINT private_channel_deposits_status_check
        CHECK (status IN ('prepared', 'submitted', 'confirmed', 'credited', 'failed'))
);

-- List a project's deposits, newest first.
CREATE INDEX IF NOT EXISTS idx_private_channel_deposits_project_created
    ON private_channel_deposits(project_id, created_at DESC);

-- The reconciler scans non-terminal deposits (drive submitted->confirmed->credited,
-- fail stale). Partial index keeps that scan cheap as terminal rows accumulate.
CREATE INDEX IF NOT EXISTS idx_private_channel_deposits_pending
    ON private_channel_deposits(updated_at)
    WHERE status IN ('prepared', 'submitted', 'confirmed');

-- Guard query: are there non-terminal deposits blocking instance deletion?
CREATE INDEX IF NOT EXISTS idx_private_channel_deposits_instance_status
    ON private_channel_deposits(instance_id)
    WHERE status IN ('prepared', 'submitted', 'confirmed');
