-- Private Channels withdrawals: withdrawal intents that burn a user's channel-chain
-- token balance (via the withdraw program) and are later settled by the operator
-- releasing real USDC on devnet from the instance escrow ATA to `destination`.
-- Lifecycle: pending -> submitted -> burn_confirmed -> release_pending -> released
-- (or failed pre-burn / manual_review after burn). Amounts are decimal strings.
--
-- Like deposits (0029), withdrawals are FINANCIAL/AUDIT records: `instance_id` is
-- denormalized with NO FK so a withdrawal SURVIVES instance deletion, and the
-- reconciliation endpoints (gateway/chain RPC/escrow instance) are SNAPSHOTTED on
-- the row so a later reconnect can't move the chain a pending withdrawal reconciles
-- against. `release_signature` is the devnet settlement correlation (settlement_ref).
--
-- Asymmetry vs deposits: release detection is UNAUTHENTICATED (the release lands on
-- public devnet, found by getSignaturesForAddress on the instance ATA), so a
-- withdrawal can reach `released` even while deposit crediting is blocked on the
-- gateway JWT work. NEVER auto-`failed` after `burn_confirmed` (the balance is
-- already gone) — an unobservable release is a settlement issue → `manual_review`.

CREATE TABLE IF NOT EXISTS private_channel_withdrawals (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    -- Channel-chain address whose token balance is burned (the burn `user`).
    owner TEXT NOT NULL,
    -- Devnet address that receives the operator's real-USDC release.
    destination TEXT NOT NULL,
    mint TEXT NOT NULL,
    amount TEXT NOT NULL,
    -- Instance config snapshotted at intent time (immutable reconciliation context).
    gateway_url TEXT NOT NULL DEFAULT '',
    chain_rpc_url TEXT NOT NULL DEFAULT '',
    escrow_program_id TEXT NOT NULL DEFAULT '',
    escrow_instance_addr TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    -- Channel-chain burn signature (set on submit).
    burn_signature TEXT,
    -- Devnet release signature = the settlement correlation (set on released).
    release_signature TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    -- org/project cascade with their parents; instance_id is intentionally NOT a
    -- FK so the withdrawal record outlives the instance (financial history).
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

    CONSTRAINT private_channel_withdrawals_status_check
        CHECK (status IN (
            'pending', 'submitted', 'burn_confirmed', 'release_pending',
            'released', 'failed', 'manual_review'
        ))
);

-- List a project's withdrawals, newest first.
CREATE INDEX IF NOT EXISTS idx_private_channel_withdrawals_project_created
    ON private_channel_withdrawals(project_id, created_at DESC);

-- The reconciler scans non-terminal withdrawals (drive submitted->burn_confirmed->
-- release_pending->released, fail stale pre-burn). Partial index keeps that scan
-- cheap as terminal rows (released/failed/manual_review) accumulate.
CREATE INDEX IF NOT EXISTS idx_private_channel_withdrawals_pending
    ON private_channel_withdrawals(updated_at)
    WHERE status IN ('pending', 'submitted', 'burn_confirmed', 'release_pending');

-- Guard query: are there non-terminal withdrawals blocking instance deletion?
CREATE INDEX IF NOT EXISTS idx_private_channel_withdrawals_instance_status
    ON private_channel_withdrawals(instance_id)
    WHERE status IN ('pending', 'submitted', 'burn_confirmed', 'release_pending');
