/**
 * SPC wallet-verification live round-trip.
 *
 * The "strong proof" for the verification vertical slice: a real hosted-custody
 * wallet (Privy) is driven through SDP's POST /v1/private-channels/wallets/:id/verify
 * end-to-end — register/login (POC bridge) → challenge → sign via Privy →
 * verify against a live SPC auth service → persisted verified_wallets row.
 *
 * Requires live infra, so it is HARD-GATED and soft-skips otherwise:
 *   RUN_INTEGRATION_TESTS=true, PRIVY_APP_ID, PRIVY_APP_SECRET,
 *   PRIVATE_CHANNELS_ENABLED=true, PRIVATE_CHANNEL_POC_AUTH_SECRET,
 *   SPC_AUTH_URL (base URL of an auth-enabled SPC :8903 service).
 *
 * The instance row is seeded directly (auth-enabled) rather than driving the
 * full Connect probe, so the test exercises only the auth handshake — not the
 * gateway/chain/escrow validation, which is orthogonal to verification.
 */

import { getDb } from "@sdp/api/db";
import { TEST_ORG } from "@sdp/api-test/fixtures/organizations";
import { TEST_PROJECT } from "@sdp/api-test/fixtures/tokens";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationSuite,
  env,
  initIntegrationSuite,
  requestWithApiKey,
} from "../helpers/integration";

// Extra env not declared on the base integration env type.
const extra = env as Record<string, string | undefined>;
const SPC_AUTH_URL = extra.SPC_AUTH_URL;

const CONFIGURED =
  env.RUN_INTEGRATION_TESTS === "true" &&
  !!env.PRIVY_APP_ID &&
  !!env.PRIVY_APP_SECRET &&
  extra.PRIVATE_CHANNELS_ENABLED === "true" &&
  !!extra.PRIVATE_CHANNEL_POC_AUTH_SECRET &&
  !!SPC_AUTH_URL;

const INSTANCE_ID = "pci_verify_integration";

async function seedAuthEnabledInstance(): Promise<void> {
  const db = getDb(env);
  await db
    .prepare("DELETE FROM private_channel_verified_wallets WHERE instance_id = ?")
    .bind(INSTANCE_ID)
    .run()
    .catch(() => {});
  await db
    .prepare("DELETE FROM private_channel_instances WHERE id = ?")
    .bind(INSTANCE_ID)
    .run()
    .catch(() => {});
  await db
    .prepare(
      `INSERT INTO private_channel_instances (
         id, organization_id, project_id,
         gateway_url, chain_rpc_url,
         escrow_program_id, withdraw_program_id, escrow_instance_addr,
         use_auth, auth_url, is_active, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, TRUE, NULL)`
    )
    .bind(
      INSTANCE_ID,
      TEST_ORG.id,
      TEST_PROJECT.id,
      extra.SPC_GATEWAY_URL ?? "http://spc-gateway.invalid:8899",
      extra.SOLANA_RPC_URL ?? "http://spc-chain.invalid:8899",
      extra.SPC_ESCROW_PROGRAM_ID ?? "11111111111111111111111111111111",
      extra.SPC_WITHDRAW_PROGRAM_ID ?? "11111111111111111111111111111111",
      extra.SPC_ESCROW_INSTANCE_ADDR ?? "11111111111111111111111111111111",
      SPC_AUTH_URL
    )
    .run();
}

async function cleanupInstance(): Promise<void> {
  const db = getDb(env);
  await db
    .prepare("DELETE FROM private_channel_verified_wallets WHERE instance_id = ?")
    .bind(INSTANCE_ID)
    .run()
    .catch(() => {});
  await db
    .prepare("DELETE FROM private_channel_instances WHERE id = ?")
    .bind(INSTANCE_ID)
    .run()
    .catch(() => {});
}

describe.skipIf(!CONFIGURED)("SPC wallet verification (live round-trip)", () => {
  const request = requestWithApiKey();

  beforeAll(async () => {
    await initIntegrationSuite();
    await seedAuthEnabledInstance();
  });

  afterAll(async () => {
    await cleanupInstance();
    await cleanupIntegrationSuite();
  });

  it("verifies a Privy custody wallet through challenge → sign → verify", {
    timeout: 120000,
  }, async () => {
    // 1. Provision a real Privy custody wallet.
    const createWalletRes = await request("/v1/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "privy", label: "SPC verify integration wallet" }),
    });
    const createWalletPayload = await createWalletRes.text();
    if (createWalletRes.status !== 201) {
      throw new Error(
        `Privy wallet creation failed (${createWalletRes.status}): ${createWalletPayload}`
      );
    }
    const { data } = JSON.parse(createWalletPayload) as {
      data: { wallet: { walletId: string; publicKey: string } };
    };
    const { walletId, publicKey } = data.wallet;

    // 2. Verify the wallet with the connected (auth-enabled) SPC instance.
    const verifyRes = await request(`/v1/private-channels/wallets/${walletId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const verifyPayload = await verifyRes.text();
    if (verifyRes.status !== 200) {
      throw new Error(`Wallet verification failed (${verifyRes.status}): ${verifyPayload}`);
    }
    const verified = JSON.parse(verifyPayload) as {
      data: { wallet: { walletId: string; pubkey: string; status: string } };
    };
    expect(verified.data.wallet.walletId).toBe(walletId);
    expect(verified.data.wallet.pubkey).toBe(publicKey);
    expect(verified.data.wallet.status).toBe("active");

    // 3. It shows up in the verified-wallets listing.
    const listRes = await request("/v1/private-channels/wallets", { method: "GET" });
    expect(listRes.status).toBe(200);
    const list = JSON.parse(await listRes.text()) as {
      data: { wallets: Array<{ pubkey: string }> };
    };
    expect(list.data.wallets.some((w) => w.pubkey === publicKey)).toBe(true);

    // 4. Re-verifying is idempotent (same row, still 200).
    const reverifyRes = await request(`/v1/private-channels/wallets/${walletId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(reverifyRes.status).toBe(200);
  });
});
