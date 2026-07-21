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
    -- these; the user never sees them. Password ciphertext is AES-GCM encrypted
    -- with SPC_CREDENTIAL_ENCRYPTION_KEY (base64 IV + ciphertext + auth tag,
    -- per EncryptionService).
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
