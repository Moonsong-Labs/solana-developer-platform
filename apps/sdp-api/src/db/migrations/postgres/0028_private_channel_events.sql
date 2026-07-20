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
