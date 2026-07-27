import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/migrations/postgres/0037_private_channel_membership_roles.sql"
);

it("upgrades existing memberships and backfills one owner per active channel", async () => {
  expect(existsSync(migrationPath)).toBe(true);
  if (!existsSync(migrationPath)) return;

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN");

  try {
    await client.query("CREATE SCHEMA role_migration_test");
    await client.query("SET LOCAL search_path TO role_migration_test");
    await client.query(`
      CREATE TABLE private_channels (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );
      CREATE TABLE private_channel_memberships (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        private_channel_user_id TEXT NOT NULL,
        added_at TEXT NOT NULL
      );
      INSERT INTO private_channels (id, status)
      VALUES ('active_channel', 'active'), ('archived_channel', 'archived');
      INSERT INTO private_channel_memberships
        (id, channel_id, private_channel_user_id, added_at)
      VALUES
        ('later_member', 'active_channel', 'user_2', '2026-02-01T00:00:00.000Z'),
        ('first_member', 'active_channel', 'user_1', '2026-01-01T00:00:00.000Z'),
        ('archived_member', 'archived_channel', 'user_3', '2026-01-01T00:00:00.000Z');
    `);

    const sql = readFileSync(migrationPath, "utf8");
    await client.query(sql);
    await client.query(sql);

    const roles = await client.query<{ id: string; role: string }>(
      "SELECT id, role FROM private_channel_memberships ORDER BY id"
    );
    expect(roles.rows).toEqual([
      { id: "archived_member", role: "member" },
      { id: "first_member", role: "owner" },
      { id: "later_member", role: "member" },
    ]);

    await client.query(`
      INSERT INTO private_channel_memberships
        (id, channel_id, private_channel_user_id, added_at)
      VALUES ('new_member', 'active_channel', 'user_4', '2026-03-01T00:00:00.000Z')
    `);
    const inserted = await client.query<{ role: string }>(
      "SELECT role FROM private_channel_memberships WHERE id = 'new_member'"
    );
    expect(inserted.rows[0]?.role).toBe("member");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
