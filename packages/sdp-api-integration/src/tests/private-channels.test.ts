/**
 * Solana Private Channels (SPC) — live gateway connectivity.
 *
 * The proven SDP → SPC pathway, exercised through the shared
 * `@sdp/private-channels` client. App-free: only `@sdp/private-channels` + the
 * test helper are imported.
 *
 * Run: RUN_INTEGRATION_TESTS=true PRIVATE_CHANNEL_GATEWAY_URL=… \
 *        pnpm --filter @sdp/api-integration test
 */

import {
  createChannelGatewayRpc,
  getChannelTokenBalance,
  probeGatewayHealth,
} from "@sdp/private-channels";
import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { env } from "#env-impl";
import {
  getGatewayUrl,
  PRIVATE_CHANNEL_CONFIGURED,
  RUN_INTEGRATION_TESTS,
} from "../helpers/private-channels";

// Devnet USDC (classic Token program) + a real devnet account to derive an ATA for.
const DEVNET_USDC = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SAMPLE_OWNER = address("7C1Pu8mbHaDDTFnGH8YTqemNDofqXP3XEotzSo6TbwHz");

describe.skipIf(!PRIVATE_CHANNEL_CONFIGURED || !RUN_INTEGRATION_TESTS)(
  "Private Channels connectivity",
  () => {
    it("is healthy: the probe reports the gateway ready", async () => {
      const result = await probeGatewayHealth(getGatewayUrl());

      expect(result.status).toBe("ready");
    });

    it("gateway RPC: getLatestBlockhash succeeds against the gateway", async () => {
      const rpc = createChannelGatewayRpc(env, getGatewayUrl());

      const { value } = await rpc.getLatestBlockhash().send();

      expect(value.blockhash).toBeTruthy();
    });

    it("gateway RPC: an unauthenticated channel balance read is rejected", async () => {
      // The gateway enforces RBAC per method. Verified live against the sandbox:
      // getLatestBlockhash and getTokenAccountsByOwner answer 200 without a bearer,
      // but getAccountInfo — which getChannelTokenBalance needs — answers 401. This
      // suite is deliberately app-free and therefore tokenless, so the reachable
      // assertion is that the balance path is gated, not that it returns a balance.
      //
      // A positive-path test needs a member JWT, which means the app harness
      // (getSpcSession + withGatewayRpc). Note that even a valid member bearer gets
      // 403 on this method for its own verified wallet, so a green authorized read is
      // not demonstrable against this instance today.
      const rpc = createChannelGatewayRpc(env, getGatewayUrl());

      await expect(getChannelTokenBalance(rpc, SAMPLE_OWNER, DEVNET_USDC)).rejects.toThrow(
        /401|[Uu]nauthorized/
      );
    });
  }
);
