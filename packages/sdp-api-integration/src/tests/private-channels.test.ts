/**
 * Solana Private Channels (SPC) — connectivity + balance reads.
 *
 * The first proven SDP → SPC pathways (SPC-INTEGRATION.md §5), now exercised
 * through the shared `@sdp/spc` client instead of ad-hoc glue. App-free: only
 * `@sdp/spc` + the test helper are imported.
 *
 * Run: `pnpm test:spc`  (override with PRIVATE_CHANNEL_GATEWAY_URL=…)
 *
 * NOTE: auth is OFF on the sandbox, so the Bearer case proves the header is
 * accepted, not that RBAC is enforced.
 */
import { getRecentBlockhash } from "@sdp/rpc/solana";
import { gatewayHealth, gatewayReady, getChannelBalance } from "@sdp/spc";
import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  createGatewayRpc,
  getSpcConfig,
  getUsdcMint,
  RUN_INTEGRATION_TESTS,
  rawGatewayRpc,
  SPC_CONFIGURED,
} from "../helpers/private-channels";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

describe.skipIf(!SPC_CONFIGURED || !RUN_INTEGRATION_TESTS)("Private Channels connectivity", () => {
  it("reaches the channel ledger via getLatestBlockhash", async () => {
    const rpc = createGatewayRpc();

    const bh = await getRecentBlockhash(rpc);

    expect(bh.blockhash).toMatch(BASE58_RE);
    expect(bh.lastValidBlockHeight).toBeGreaterThan(0n);
  });

  it("is healthy: GET /health and GET /ready return 200", async () => {
    const config = getSpcConfig();

    const health = await gatewayHealth(config);
    expect(health.status).toBe(200);

    const ready = await gatewayReady(config);
    expect(ready.status).toBe(200);
  });

  it("exposes only the documented JSON-RPC subset (getVersion is not implemented)", async () => {
    const response = await rawGatewayRpc("getVersion");

    // -32601 = Method not found (SPC-INTEGRATION.md §4.2 — getVersion is not implemented).
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.message).toMatch(/method not found/i);
    }
  });

  it("accepts a Bearer-authorized client (auth-ready path)", async () => {
    const authed = createGatewayRpc({ bearer: "private-channels-connectivity-test" });

    const bh = await getRecentBlockhash(authed);

    expect(bh.blockhash).toMatch(BASE58_RE);
  });
});

describe.skipIf(!SPC_CONFIGURED || !RUN_INTEGRATION_TESTS || !getUsdcMint())(
  "Private Channels balances",
  () => {
    it("derives an ATA and reads a channel balance via getTokenAccountBalance", async () => {
      const rpc = createGatewayRpc();
      const mint = getUsdcMint() as Address;
      // An arbitrary owner: its USDC ATA is not expected to exist, which still
      // exercises token-program resolution + ATA derivation + the read path.
      const wallet = "So11111111111111111111111111111111111111112" as Address;

      const balance = await getChannelBalance(rpc, { wallet, mint });

      expect(balance.ata).toMatch(BASE58_RE);
      expect(balance.tokenProgram).toMatch(BASE58_RE);
      expect(typeof balance.amount).toBe("bigint");
      expect(balance.decimals).toBeGreaterThanOrEqual(0);
    });
  }
);
