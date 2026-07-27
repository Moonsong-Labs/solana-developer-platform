import { SANDBOX_DEFAULTS } from "@sdp/private-channels";
import { PRIVATE_CHANNEL_MEMBERSHIP_ROLES } from "@sdp/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { TEST_ORG, TEST_USER } from "@/test/fixtures/organizations";
import { env } from "@/test/helpers/env";
import { clearTestDatabase, seedTestDatabase } from "@/test/mocks/db";
import { createPostgresPrivateChannelInstanceRepository } from "./private-channel-instance.repository.postgres";
import type { PrivateChannelUserRepository } from "./private-channel-user.repository";
import { createPostgresPrivateChannelUserRepository } from "./private-channel-user.repository.postgres";
import { createPostgresPrivateChannelVerifiedWalletRepository } from "./private-channel-verified-wallet.repository.postgres";

const TEST_PROJECT_ID = "prj_pcu_repo_test";
const PCU_ID = "pcu_pcu_repo_test";
const PUBKEY_A = "So11111111111111111111111111111111111111112";
const PUBKEY_B = "So11111111111111111111111111111111111111113";

// verified_wallet_count is a derived read; it must reflect only the project's
// ACTIVE instance so a stale/deactivated instance's verifications don't leak in.
describe("PrivateChannelUserRepository (postgres) — verified_wallet_count", () => {
  let repo: PrivateChannelUserRepository;
  let instanceRepo: ReturnType<typeof createPostgresPrivateChannelInstanceRepository>;
  let walletRepo: ReturnType<typeof createPostgresPrivateChannelVerifiedWalletRepository>;

  const scope = { organizationId: TEST_ORG.id, projectId: TEST_PROJECT_ID };

  beforeAll(async () => {
    await seedTestDatabase(env as Parameters<typeof seedTestDatabase>[0]);
  });

  afterAll(async () => {
    await clearTestDatabase(env as Parameters<typeof clearTestDatabase>[0]);
  });

  beforeEach(async () => {
    const db = getDb(env);
    await db.prepare("DELETE FROM private_channel_verified_wallets").run();
    await db.prepare("DELETE FROM private_channel_users").run();
    await db.prepare("DELETE FROM private_channel_instances").run();
    await db.prepare("DELETE FROM projects").run();

    await db
      .prepare(
        "INSERT OR REPLACE INTO organizations (id, name, slug, tier, status) VALUES (?, ?, ?, 'individual', 'active')"
      )
      .bind(TEST_ORG.id, TEST_ORG.name, TEST_ORG.slug)
      .run();
    await db
      .prepare(
        "INSERT OR REPLACE INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')"
      )
      .bind(TEST_USER.id, TEST_USER.email)
      .run();
    await db
      .prepare(
        `INSERT INTO projects (id, organization_id, name, slug, environment, status, created_by)
           VALUES (?, ?, 'Test Project', ?, 'sandbox', 'active', ?)`
      )
      .bind(TEST_PROJECT_ID, TEST_ORG.id, TEST_PROJECT_ID, TEST_USER.id)
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
           VALUES (?, ?, ?, ?)`
      )
      .bind(PCU_ID, TEST_ORG.id, TEST_PROJECT_ID, TEST_USER.id)
      .run();

    instanceRepo = createPostgresPrivateChannelInstanceRepository(db);
    walletRepo = createPostgresPrivateChannelVerifiedWalletRepository(db);
    repo = createPostgresPrivateChannelUserRepository(db);
  });

  // A gateway_url is unique per project, so a second instance needs its own.
  async function connectInstance(gatewayUrl?: string): Promise<string> {
    const created = await instanceRepo.createActive({
      organizationId: TEST_ORG.id,
      projectId: TEST_PROJECT_ID,
      createdBy: TEST_USER.id,
      ...SANDBOX_DEFAULTS,
      ...(gatewayUrl ? { gatewayUrl } : {}),
    });
    if (!created) throw new Error("createActive returned null");
    return created.id;
  }

  it("counts the member's wallets verified under the active instance", async () => {
    const instanceA = await connectInstance();
    await walletRepo.upsert({
      ...scope,
      userId: PCU_ID,
      instanceId: instanceA,
      walletId: "wal_1",
      pubkey: PUBKEY_A,
    });
    await walletRepo.upsert({
      ...scope,
      userId: PCU_ID,
      instanceId: instanceA,
      walletId: "wal_2",
      pubkey: PUBKEY_B,
    });

    const [listed] = await repo.listByProject(scope);
    expect(listed.verified_wallet_count).toBe(2);
    const fetched = await repo.getByProjectAndUser(scope, TEST_USER.id);
    expect(fetched?.verified_wallet_count).toBe(2);
  });

  it("excludes verifications made under a since-deactivated instance", async () => {
    const instanceA = await connectInstance();
    await walletRepo.upsert({
      ...scope,
      userId: PCU_ID,
      instanceId: instanceA,
      walletId: "wal_1",
      pubkey: PUBKEY_A,
    });

    // Reconnect to a new instance: A is deactivated, B becomes the active one.
    await instanceRepo.deactivateActive(scope);
    const instanceB = await connectInstance("http://other.example:8899");
    await walletRepo.upsert({
      ...scope,
      userId: PCU_ID,
      instanceId: instanceB,
      walletId: "wal_2",
      pubkey: PUBKEY_B,
    });

    const [listed] = await repo.listByProject(scope);
    expect(listed.verified_wallet_count).toBe(1);
  });

  it("is 0 when the project has no active instance", async () => {
    const instanceA = await connectInstance();
    await walletRepo.upsert({
      ...scope,
      userId: PCU_ID,
      instanceId: instanceA,
      walletId: "wal_1",
      pubkey: PUBKEY_A,
    });
    await instanceRepo.deactivateActive(scope);

    const [listed] = await repo.listByProject(scope);
    expect(listed.verified_wallet_count).toBe(0);
  });

  it("makes the first channel member owner and preserves later membership roles", async () => {
    const db = getDb(env);
    const instanceId = await connectInstance();
    const channelId = "pch_role_test";
    await db
      .prepare(
        `INSERT INTO private_channels
           (id, organization_id, project_id, instance_id, name, is_default)
         VALUES (?, ?, ?, ?, 'Role test', FALSE)`
      )
      .bind(channelId, TEST_ORG.id, TEST_PROJECT_ID, instanceId)
      .run();

    const created = await repo.addMembership({
      channelId,
      privateChannelUserId: PCU_ID,
      addedBy: TEST_USER.id,
      role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
    });
    expect(created.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER);

    const [listed] = await repo.listMembershipsForUser(PCU_ID);
    expect(listed.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER);
    expect(
      await repo.updateMembershipRole(channelId, PCU_ID, PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER)
    ).toBeNull();
    expect(await repo.removeMembership(channelId, PCU_ID)).toBe(false);

    await db
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')")
      .bind("usr_role_viewer", "role-viewer@example.com")
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind("pcu_role_viewer", TEST_ORG.id, TEST_PROJECT_ID, "usr_role_viewer")
      .run();

    const viewer = await repo.addMembership({
      channelId,
      privateChannelUserId: "pcu_role_viewer",
      addedBy: TEST_USER.id,
      role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER,
    });
    expect(viewer.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER);
    const promoted = await repo.updateMembershipRole(
      channelId,
      "pcu_role_viewer",
      PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN
    );
    expect(promoted?.previousRole).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER);
    expect(promoted?.membership.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN);
    expect(await repo.countChannelManagers(channelId)).toBe(2);
    expect(await repo.deleteById(scope, PCU_ID)).toBe(false);
  });

  it("transfers ownership and demotes the previous owner to admin", async () => {
    const db = getDb(env);
    const instanceId = await connectInstance();
    const channelId = "pch_owner_transfer";
    await db
      .prepare(
        `INSERT INTO private_channels
           (id, organization_id, project_id, instance_id, name, is_default)
         VALUES (?, ?, ?, ?, 'Owner transfer', FALSE)`
      )
      .bind(channelId, TEST_ORG.id, TEST_PROJECT_ID, instanceId)
      .run();
    await db
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')")
      .bind("usr_new_owner", "new-owner@example.com")
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind("pcu_new_owner", TEST_ORG.id, TEST_PROJECT_ID, "usr_new_owner")
      .run();
    await repo.addMembership({
      channelId,
      privateChannelUserId: PCU_ID,
      addedBy: TEST_USER.id,
      role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
    });
    await repo.addMembership({
      channelId,
      privateChannelUserId: "pcu_new_owner",
      addedBy: TEST_USER.id,
      role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
    });

    expect(
      await repo.transferChannelOwnership(channelId, "pcu_new_owner", "pcu_stale_owner")
    ).toBeNull();
    const transferred = await repo.transferChannelOwnership(channelId, "pcu_new_owner", PCU_ID);

    expect(transferred?.previousOwner.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN);
    expect(transferred?.owner.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER);
    expect(transferred?.ownerPreviousRole).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER);
  });

  // The handler pre-checks this too, but only the repository holds the channel
  // lock, so it has to stand on its own when two managers step down at once.
  it("keeps the last manager of an active channel", async () => {
    const db = getDb(env);
    const instanceId = await connectInstance();
    const channelId = "pch_last_manager";
    await db
      .prepare(
        `INSERT INTO private_channels
           (id, organization_id, project_id, instance_id, name, is_default)
         VALUES (?, ?, ?, ?, 'Last manager', FALSE)`
      )
      .bind(channelId, TEST_ORG.id, TEST_PROJECT_ID, instanceId)
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_memberships (id, channel_id, private_channel_user_id, role)
         VALUES (?, ?, ?, ?)`
      )
      .bind("pcm_sole_admin", channelId, PCU_ID, PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN)
      .run();

    expect(
      await repo.updateMembershipRole(channelId, PCU_ID, PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER)
    ).toBeNull();
    expect(await repo.removeMembership(channelId, PCU_ID)).toBe(false);

    await db
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')")
      .bind("usr_second_admin", "second-admin@example.com")
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind("pcu_second_admin", TEST_ORG.id, TEST_PROJECT_ID, "usr_second_admin")
      .run();
    await repo.addMembership({
      channelId,
      privateChannelUserId: "pcu_second_admin",
      addedBy: TEST_USER.id,
      role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
    });

    expect(await repo.removeMembership(channelId, PCU_ID)).toBe(true);
  });
});
