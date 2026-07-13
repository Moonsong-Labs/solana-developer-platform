/**
 * Solana Private Channels (SPC) — connectivity + balance reads.
 *
 * The first proven SDP → SPC pathways, now exercised
 * through the shared `@sdp/private-channels` client instead of ad-hoc glue. App-free: only
 * `@sdp/private-channels` + the test helper are imported.
 *
 * Run: `pnpm test:private-channels`  (override with PRIVATE_CHANNEL_GATEWAY_URL=…)
 *
 * NOTE: auth is OFF on the sandbox, so the Bearer case proves the header is
 * accepted, not that RBAC is enforced.
 */

import { getChannelBalance, probeGatewayHealth } from "@sdp/private-channels";
import { getRecentBlockhash } from "@sdp/rpc/solana";
import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  createGatewayRpc,
  getPrivateChannelConfig,
  getUsdcMint,
  PRIVATE_CHANNEL_CONFIGURED,
  RUN_INTEGRATION_TESTS,
  rawGatewayRpc,
} from "../helpers/private-channels";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

describe.skipIf(!PRIVATE_CHANNEL_CONFIGURED || !RUN_INTEGRATION_TESTS)(
  "Private Channels connectivity",
  () => {
    it("reaches the channel ledger via getLatestBlockhash", async () => {
      const rpc = createGatewayRpc();

      const bh = await getRecentBlockhash(rpc);

      expect(bh.blockhash).toMatch(BASE58_RE);
      expect(bh.lastValidBlockHeight).toBeGreaterThan(0n);
    });

    it("is healthy: the probe reports the gateway ready", async () => {
      const config = getPrivateChannelConfig();

      const result = await probeGatewayHealth(config.gatewayUrl);

      expect(result.status).toBe("ready");
    });

    it("exposes only the documented JSON-RPC subset (getVersion is not implemented)", async () => {
      const response = await rawGatewayRpc("getVersion");

      // -32601 = Method not found (getVersion is not implemented on the gateway).
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
  }
);

describe.skipIf(!PRIVATE_CHANNEL_CONFIGURED || !RUN_INTEGRATION_TESTS || !getUsdcMint())(
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
