import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { TEST_ORG, TEST_USER } from "@/test/fixtures/organizations";
import { env } from "@/test/helpers/env";
import { clearTestDatabase, seedTestDatabase } from "@/test/mocks/db";
import type {
  CreateDepositInput,
  PrivateChannelDepositRepository,
} from "./private-channel-deposit.repository";
import { createPostgresPrivateChannelDepositRepository } from "./private-channel-deposit.repository.postgres";

const TEST_PROJECT_ID = "prj_pcd_repo_test";
const TEST_INSTANCE_ID = "inst_pcd_1";
const RECIPIENT = "RecipientAddr11111111111111111111111111111";
const MINT = "MintAddr11111111111111111111111111111111111";
// The deposit's acting member. private_channel_user_id FKs this row, so it has to
// exist (and be re-seeded after each `DELETE FROM projects`, which cascades to it).
const TEST_PC_USER_ID = "pcu_pcd_repo_test";

function makeInput(overrides: Partial<CreateDepositInput> = {}): CreateDepositInput {
  return {
    organizationId: TEST_ORG.id,
    projectId: TEST_PROJECT_ID,
    instanceId: TEST_INSTANCE_ID,
    walletId: "wal_pcd_1",
    depositor: "DepositorAddr1111111111111111111111111111",
    recipient: RECIPIENT,
    mint: MINT,
    amount: "1.5",
    privateChannelUserId: TEST_PC_USER_ID,
    baselineCredited: "0",
    gatewayUrl: "https://gw.example",
    chainRpcUrl: "https://devnet.example",
    escrowProgramId: "EscrowProg1111111111111111111111111111111",
    escrowInstanceAddr: "EscrowInst1111111111111111111111111111111",
    ...overrides,
  };
}

describe("PrivateChannelDepositRepository (postgres)", () => {
  let repo: PrivateChannelDepositRepository;

  beforeAll(async () => {
    await seedTestDatabase(env as Parameters<typeof seedTestDatabase>[0]);
  });

  afterAll(async () => {
    await clearTestDatabase(env as Parameters<typeof clearTestDatabase>[0]);
  });

  beforeEach(async () => {
    const db = getDb(env);
    await db.prepare("DELETE FROM private_channel_deposits").run();
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
      .bind(TEST_PC_USER_ID, TEST_ORG.id, TEST_PROJECT_ID, TEST_USER.id)
      .run();

    repo = createPostgresPrivateChannelDepositRepository(db);
  });

  /** Insert with an explicit created_at, which createDeposit cannot set. */
  async function seedDepositAt(id: string, amount: string, createdAt: string): Promise<void> {
    await getDb(env)
      .prepare(
        `INSERT INTO private_channel_deposits
           (id, organization_id, project_id, instance_id, wallet_id, depositor, recipient,
            mint, amount, private_channel_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'wal_pcd_1', 'DepositorAddr1111111111111111111111111111', ?,
            ?, ?, ?, 'confirmed', ?, ?)`
      )
      .bind(
        id,
        TEST_ORG.id,
        TEST_PROJECT_ID,
        TEST_INSTANCE_ID,
        RECIPIENT,
        MINT,
        amount,
        TEST_PC_USER_ID,
        createdAt,
        createdAt
      )
      .run();
  }

  it("createDeposit persists every column and defaults to prepared", async () => {
    const row = await repo.createDeposit(makeInput());

    expect(row).not.toBeNull();
    expect(row?.id).toMatch(/^dep_/);
    expect(row?.status).toBe("prepared");
    expect(row?.signature).toBeNull();
    expect(row?.recipient).toBe(RECIPIENT);
    expect(row?.amount).toBe("1.5");
    expect(row?.baseline_credited).toBe("0");
    // The acting member is captured so the reconciler can authenticate as them
    // instead of reverse-mapping the recipient address.
    expect(row?.private_channel_user_id).toBe(TEST_PC_USER_ID);
    // Reconciliation context is snapshotted immutably on the row.
    expect(row?.gateway_url).toBe("https://gw.example");
    expect(row?.chain_rpc_url).toBe("https://devnet.example");
    expect(row?.escrow_program_id).toBe("EscrowProg1111111111111111111111111111111");
    expect(row?.escrow_instance_addr).toBe("EscrowInst1111111111111111111111111111111");
  });

  it("createDeposit rejects a member that does not exist", async () => {
    // The FK is what keeps the reconciler's identity resolvable; a typo must fail
    // loudly at intent time rather than produce a row it can never authenticate.
    await expect(
      repo.createDeposit(makeInput({ privateChannelUserId: "pcu_nope" }))
    ).rejects.toThrow();
  });

  describe("listDepositsForRecipient", () => {
    it("returns the group oldest first", async () => {
      await seedDepositAt("dep_b", "2", "2026-02-01T00:00:00.000Z");
      await seedDepositAt("dep_a", "1", "2026-01-01T00:00:00.000Z");

      const rows = await repo.listDepositsForRecipient({
        instanceId: TEST_INSTANCE_ID,
        recipient: RECIPIENT,
        mint: MINT,
      });

      expect(rows.map((r) => r.id)).toEqual(["dep_a", "dep_b"]);
    });

    it("breaks created_at ties on id ASC so credit planning is deterministic", async () => {
      // deposit-credit walks this list in order, anchors its threshold on the first
      // row's baseline_credited and breaks at the first row exceeding balance — so an
      // unstable order across ticks would change which deposits get credited.
      const sameInstant = "2026-03-01T00:00:00.000Z";
      await seedDepositAt("dep_c", "3", sameInstant);
      await seedDepositAt("dep_a", "1", sameInstant);
      await seedDepositAt("dep_b", "2", sameInstant);

      const first = await repo.listDepositsForRecipient({
        instanceId: TEST_INSTANCE_ID,
        recipient: RECIPIENT,
        mint: MINT,
      });
      const second = await repo.listDepositsForRecipient({
        instanceId: TEST_INSTANCE_ID,
        recipient: RECIPIENT,
        mint: MINT,
      });

      expect(first.map((r) => r.id)).toEqual(["dep_a", "dep_b", "dep_c"]);
      expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    });

    it("excludes another instance's deposits for the same recipient", async () => {
      await seedDepositAt("dep_a", "1", "2026-01-01T00:00:00.000Z");
      await getDb(env)
        .prepare(
          `UPDATE private_channel_deposits SET instance_id = 'inst_other' WHERE id = 'dep_a'`
        )
        .run();

      const rows = await repo.listDepositsForRecipient({
        instanceId: TEST_INSTANCE_ID,
        recipient: RECIPIENT,
        mint: MINT,
      });

      expect(rows).toEqual([]);
    });
  });
});
