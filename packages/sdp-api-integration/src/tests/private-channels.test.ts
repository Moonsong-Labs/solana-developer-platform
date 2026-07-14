/**
 * Solana Private Channels (SPC) — gateway health connectivity.
 *
 * The first proven SDP → SPC pathway, exercised through the shared
 * `@sdp/private-channels` client. App-free: only `@sdp/private-channels` + the
 * test helper are imported.
 *
 * Run: `pnpm test:private-channels`  (override with PRIVATE_CHANNEL_GATEWAY_URL=…)
 */

import { probeGatewayHealth } from "@sdp/private-channels";
import { describe, expect, it } from "vitest";
import {
  getPrivateChannelConfig,
  PRIVATE_CHANNEL_CONFIGURED,
  RUN_INTEGRATION_TESTS,
} from "../helpers/private-channels";

describe.skipIf(!PRIVATE_CHANNEL_CONFIGURED || !RUN_INTEGRATION_TESTS)(
  "Private Channels connectivity",
  () => {
    it("is healthy: the probe reports the gateway ready", async () => {
      const config = getPrivateChannelConfig();

      const result = await probeGatewayHealth(config.gatewayUrl);

      expect(result.status).toBe("ready");
    });
  }
);
