-- Private Channels (SPC): the whole feature's schema, in one migration.
--
-- Tables are declared in dependency order — the connected instance, then its
-- channels, members and event feed, then deposits, withdrawals and verified
-- wallets. Every statement is IF NOT EXISTS, so re-running is a no-op.
--
-- This was originally seven migrations (0025-0031) authored while Private
-- Channels sat on a branch. Those numbers collided with main's payments
-- migrations on every merge, so they are consolidated here: the feature has
-- never shipped, so there is no applied history to preserve.


-- ==========================================================================
-- private channel instances

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


-- ==========================================================================
-- private channels

-- Logical channels: named groupings within an SPC instance. Exactly one channel
-- per instance is the auto-provisioned default (is_default).

CREATE TABLE IF NOT EXISTS private_channels (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES private_channel_instances(id) ON DELETE CASCADE,

    CONSTRAINT private_channels_status_check CHECK (status IN ('active', 'archived'))
);

-- Channel names are unique within an instance. Also the conflict target for createChannel.
CREATE UNIQUE INDEX IF NOT EXISTS private_channels_instance_name_key
    ON private_channels(instance_id, name);

-- At most one default channel per instance.
CREATE UNIQUE INDEX IF NOT EXISTS private_channels_one_default_per_instance
    ON private_channels(instance_id)
    WHERE is_default;

-- List an instance's active channels, newest first.
CREATE INDEX IF NOT EXISTS idx_private_channels_instance_created
    ON private_channels(instance_id, created_at DESC)
    WHERE status = 'active';


-- ==========================================================================
-- private channel users

-- Private Channel users: SDP users invited to an SPC workspace, scoped to a
-- project. Kept as its own table so PC-specific state (SPC credential, invite
-- bookkeeping) doesn't pollute the shared `users` table. FK to users(id)
-- preserves the identity link.
--
-- Revoke = hard-delete the row. FK cascades clean the channel memberships.

CREATE TABLE IF NOT EXISTS private_channel_users (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    -- SPC credential (created by POST /auth/register at invite time). SDP owns
    -- these; the user never sees them. The password ciphertext is written by the
    -- SPC cipher router: either AES-GCM under SPC_CREDENTIAL_ENCRYPTION_KEY
    -- (base64 IV + ciphertext + auth tag, per EncryptionService) or, when
    -- SPC_CREDENTIAL_KMS_KEY_NAME is set, a `v2.`-prefixed Cloud KMS envelope.
    -- Decryption dispatches on that prefix, so no version column is needed.
    spc_user_id TEXT,
    spc_username TEXT,
    spc_credential_ciphertext TEXT,

    invited_by TEXT,
    invite_token TEXT,
    invited_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    accepted_at TEXT,

    created_at TEXT NOT NULL DEFAULT sdp_iso_now(),
    updated_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    -- invited_by → users(id) ON DELETE SET NULL: audit is best-effort. When the
    -- inviting SDP admin is removed, the invitee stays but the "who invited
    -- them" reference is dropped. TODO: revisit if we need a durable audit
    -- record (e.g. snapshot inviter email/name into a separate audit table on
    -- invite so the trail survives inviter deletion).
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE (project_id, user_id)
);

-- Invite token lookups (email accept flow, scaffolded).
CREATE UNIQUE INDEX IF NOT EXISTS private_channel_users_invite_token_key
    ON private_channel_users(invite_token)
    WHERE invite_token IS NOT NULL AND accepted_at IS NULL;

-- Project listing.
CREATE INDEX IF NOT EXISTS idx_private_channel_users_project_created
    ON private_channel_users(project_id, created_at DESC);

-- Channel ↔ user junction. Cascades on either side so removing a channel or
-- revoking a workspace-user cleans up.
CREATE TABLE IF NOT EXISTS private_channel_memberships (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    private_channel_user_id TEXT NOT NULL,

    added_by TEXT,
    added_at TEXT NOT NULL DEFAULT sdp_iso_now(),

    FOREIGN KEY (channel_id) REFERENCES private_channels(id) ON DELETE CASCADE,
    FOREIGN KEY (private_channel_user_id) REFERENCES private_channel_users(id) ON DELETE CASCADE,
    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE (channel_id, private_channel_user_id)
);

CREATE INDEX IF NOT EXISTS idx_private_channel_memberships_channel
    ON private_channel_memberships(channel_id);
CREATE INDEX IF NOT EXISTS idx_private_channel_memberships_user
    ON private_channel_memberships(private_channel_user_id);


-- ==========================================================================
-- private channel events

-- Private channel activity events.
-- Durable, audit_logs-style trail: all scope ids (org/project/instance/channel/
-- sdp_user) are denormalized with no FK, so events survive parent deletion.

CREATE TABLE IF NOT EXISTS private_channel_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    channel_id TEXT,
    sdp_user_id TEXT,
    family TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT sdp_iso_now()
);

CREATE INDEX IF NOT EXISTS idx_private_channel_events_channel_occurred
    ON private_channel_events (channel_id, occurred_at DESC)
    WHERE channel_id IS NOT NULL;

-- Channel feed query: filter by instance_id, order by (occurred_at, id) DESC.
CREATE INDEX IF NOT EXISTS idx_private_channel_events_instance_occurred
    ON private_channel_events (instance_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_private_channel_events_project_occurred
    ON private_channel_events (project_id, occurred_at DESC);


-- ==========================================================================
-- private channel deposits

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
    -- The member who created this intent, captured while the request was still
    -- authenticated. The reconciler needs an SPC identity to read the channel
    -- balance, and this is the only unambiguous one: deriving it later from
    -- `recipient` answers "whose wallet is this" (a different question with 0, 1 or
    -- many answers) and fails outright for an external recipient.
    --
    -- SET NULL rather than CASCADE: revoking a member must not delete financial
    -- history, matching the no-FK stance on instance_id below.
    private_channel_user_id TEXT,
    baseline_credited TEXT NOT NULL DEFAULT '0',
    -- Instance config snapshotted at intent time (immutable reconciliation context).
    --
    -- TODO(snapshot-recovery): immutability cuts both ways. It stops a reconnect from
    -- silently moving the chain a pending deposit reconciles against, but it also
    -- pins a deposit to an endpoint that may DIE — if `chain_rpc_url` goes down or
    -- runs out of credits and the operator repoints the instance at a working URL,
    -- deposits snapshotted against the old one can never confirm. Needs an explicit,
    -- audited operator action to re-point a stuck deposit's snapshot (accepting
    -- responsibility for the change), rather than either silently following the
    -- instance or stranding the row.
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
    FOREIGN KEY (private_channel_user_id) REFERENCES private_channel_users(id) ON DELETE SET NULL,

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


-- ==========================================================================
-- private channel withdrawals

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
    -- The member who created this intent (see private_channel_deposits above); the
    -- reconciler authenticates its gateway reads as this member.
    private_channel_user_id TEXT,
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
    FOREIGN KEY (private_channel_user_id) REFERENCES private_channel_users(id) ON DELETE SET NULL,

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


-- ==========================================================================
-- private channel verified wallets

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
