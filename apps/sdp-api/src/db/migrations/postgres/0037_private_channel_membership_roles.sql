-- Add channel-local membership roles after the consolidated Private Channels
-- schema. This remains safe for databases that previously received the role
-- column from the superseded split migrations.

ALTER TABLE private_channel_memberships
    ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE private_channel_memberships
SET role = 'member'
WHERE role IS NULL;

-- Existing active channels predate ownership. Promote the earliest member only
-- when the channel does not already have an owner.
WITH first_members AS (
    SELECT DISTINCT ON (memberships.channel_id)
        memberships.id,
        memberships.channel_id
    FROM private_channel_memberships AS memberships
    INNER JOIN private_channels AS channels
        ON channels.id = memberships.channel_id
    WHERE channels.status = 'active'
      AND NOT EXISTS (
          SELECT 1
          FROM private_channel_memberships AS owners
          WHERE owners.channel_id = memberships.channel_id
            AND owners.role = 'owner'
      )
    ORDER BY memberships.channel_id, memberships.added_at, memberships.id
)
UPDATE private_channel_memberships AS memberships
SET role = 'owner'
FROM first_members
WHERE memberships.id = first_members.id;

ALTER TABLE private_channel_memberships
    ALTER COLUMN role SET DEFAULT 'member',
    ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'private_channel_memberships'::regclass
          AND conname = 'private_channel_memberships_role_check'
    ) THEN
        ALTER TABLE private_channel_memberships
            ADD CONSTRAINT private_channel_memberships_role_check
            CHECK (role IN ('owner', 'admin', 'member', 'viewer'));
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_private_channel_memberships_one_owner
    ON private_channel_memberships(channel_id)
    WHERE role = 'owner';
