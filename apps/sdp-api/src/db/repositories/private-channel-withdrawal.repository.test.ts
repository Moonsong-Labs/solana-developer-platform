import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { TEST_ORG, TEST_USER } from "@/test/fixtures/organizations";
import { env } from "@/test/helpers/env";
import { clearTestDatabase, seedTestDatabase } from "@/test/mocks/db";
import type {
  CreateWithdrawalInput,
  PrivateChannelWithdrawalRepository,
} from "./private-channel-withdrawal.repository";
import { createPostgresPrivateChannelWithdrawalRepository } from "./private-channel-withdrawal.repository.postgres";

const TEST_PROJECT_ID = "prj_pcw_repo_test";
// The withdrawal's acting member. private_channel_user_id FKs this row, so it has to
// exist (and be re-seeded after each `DELETE FROM projects`, which cascades to it).
const TEST_PC_USER_ID = "pcu_pcw_repo_test";

function makeInput(overrides: Partial<CreateWithdrawalInput> = {}): CreateWithdrawalInput {
  return {
    organizationId: TEST_ORG.id,
    projectId: TEST_PROJECT_ID,
    instanceId: "inst_pcw_1",
    walletId: "wal_pcw_1",
    owner: "OwnerAddr1111111111111111111111111111111111",
    destination: "DestAddr11111111111111111111111111111111111",
    mint: "MintAddr11111111111111111111111111111111111",
    amount: "1.5",
    privateChannelUserId: TEST_PC_USER_ID,
    gatewayUrl: "https://gw.example",
    chainRpcUrl: "https://devnet.example",
    escrowProgramId: "EscrowProg1111111111111111111111111111111",
    escrowInstanceAddr: "EscrowInst1111111111111111111111111111111",
    ...overrides,
  };
}

describe("PrivateChannelWithdrawalRepository (postgres)", () => {
  let repo: PrivateChannelWithdrawalRepository;

  beforeAll(async () => {
    await seedTestDatabase(env as Parameters<typeof seedTestDatabase>[0]);
  });

  afterAll(async () => {
    await clearTestDatabase(env as Parameters<typeof clearTestDatabase>[0]);
  });

  beforeEach(async () => {
    const db = getDb(env);
    await db.prepare("DELETE FROM private_channel_withdrawals").run();
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

    repo = createPostgresPrivateChannelWithdrawalRepository(db);
  });

  // Guarded creation: createWithdrawal returns Row | null; tests that use the row
  // need it non-null without a `!` assertion.
  async function seed(overrides: Partial<CreateWithdrawalInput> = {}) {
    const row = await repo.createWithdrawal(makeInput(overrides));
    if (!row) {
      throw new Error("test setup: createWithdrawal returned null");
    }
    return row;
  }

  it("createWithdrawal persists the snapshot and defaults to pending", async () => {
    const row = await repo.createWithdrawal(makeInput());

    expect(row).not.toBeNull();
    expect(row?.id).toMatch(/^wd_/);
    expect(row?.status).toBe("pending");
    expect(row?.burn_signature).toBeNull();
    expect(row?.release_signature).toBeNull();
    // Reconciliation context is snapshotted immutably on the row.
    expect(row?.gateway_url).toBe("https://gw.example");
    expect(row?.chain_rpc_url).toBe("https://devnet.example");
    expect(row?.escrow_instance_addr).toBe("EscrowInst1111111111111111111111111111111");
    // The acting member is captured so the reconciler can authenticate as them.
    expect(row?.private_channel_user_id).toBe(TEST_PC_USER_ID);
  });

  it("updateWithdrawal applies the CAS transition when expectedStatus matches", async () => {
    const created = await seed();
    const updated = await repo.updateWithdrawal({
      id: created.id,
      status: "submitted",
      burnSignature: "burnSig1",
      expectedStatus: "pending",
    });

    expect(updated?.status).toBe("submitted");
    expect(updated?.burn_signature).toBe("burnSig1");
  });

  it("updateWithdrawal is a no-op (null) when expectedStatus does not match", async () => {
    const created = await seed();
    // Row is `pending`; a worker that thinks it's `burn_confirmed` must not win.
    const updated = await repo.updateWithdrawal({
      id: created.id,
      status: "released",
      expectedStatus: "burn_confirmed",
    });

    expect(updated).toBeNull();
    const reread = await repo.getWithdrawalById({
      organizationId: TEST_ORG.id,
      projectId: TEST_PROJECT_ID,
      id: created.id,
    });
    expect(reread?.status).toBe("pending");
  });

  it("updateWithdrawal COALESCEs: a later transition keeps the burn signature", async () => {
    const created = await seed();
    await repo.updateWithdrawal({
      id: created.id,
      status: "submitted",
      burnSignature: "burnSig2",
      expectedStatus: "pending",
    });
    await repo.updateWithdrawal({
      id: created.id,
      status: "burn_confirmed",
      expectedStatus: "submitted",
    });
    const released = await repo.updateWithdrawal({
      id: created.id,
      status: "released",
      releaseSignature: "releaseSig2",
      expectedStatus: "burn_confirmed",
    });

    expect(released?.status).toBe("released");
    expect(released?.burn_signature).toBe("burnSig2"); // preserved across transitions
    expect(released?.release_signature).toBe("releaseSig2");
  });

  it("listWithdrawalsByStatus returns matching rows oldest-first, bounded by limit", async () => {
    const a = await seed();
    const b = await seed();
    await repo.updateWithdrawal({ id: b.id, status: "submitted", expectedStatus: "pending" });

    const pending = await repo.listWithdrawalsByStatus({ statuses: ["pending"], limit: 10 });
    expect(pending.map((r) => r.id)).toEqual([a.id]);

    const nonTerminal = await repo.listWithdrawalsByStatus({
      statuses: ["pending", "submitted"],
      limit: 10,
    });
    expect(nonTerminal).toHaveLength(2);
  });

  it("countNonTerminalByInstance counts only in-flight rows for the instance", async () => {
    const inFlight = await repo.createWithdrawal(makeInput({ instanceId: "inst_A" }));
    const other = await seed({ instanceId: "inst_A" });
    await repo.createWithdrawal(makeInput({ instanceId: "inst_B" }));
    // Drive one to a terminal state — it must drop out of the count.
    await repo.updateWithdrawal({ id: other.id, status: "submitted", expectedStatus: "pending" });
    await repo.updateWithdrawal({
      id: other.id,
      status: "burn_confirmed",
      expectedStatus: "submitted",
    });
    await repo.updateWithdrawal({
      id: other.id,
      status: "release_pending",
      expectedStatus: "burn_confirmed",
    });
    await repo.updateWithdrawal({
      id: other.id,
      status: "released",
      expectedStatus: "release_pending",
    });

    expect(await repo.countNonTerminalByInstance("inst_A")).toBe(1);
    expect(await repo.countNonTerminalByInstance("inst_B")).toBe(1);
    void inFlight;
  });
});
