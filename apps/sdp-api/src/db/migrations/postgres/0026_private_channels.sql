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
