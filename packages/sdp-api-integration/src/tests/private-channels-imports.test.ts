/**
 * Import smoke test.
 *
 * Verifies the `@sdp/private-channels` barrel and its live subpaths import in the
 * Workers test pool and expose their expected entry points.
 */

import * as spc from "@sdp/private-channels";
import * as balances from "@sdp/private-channels/balances";
import * as gateway from "@sdp/private-channels/gateway";
import * as health from "@sdp/private-channels/health";
import * as transfer from "@sdp/private-channels/transfer";
import { describe, expect, it } from "vitest";
import { RUN_INTEGRATION_TESTS } from "../helpers/private-channels";

describe.skipIf(!RUN_INTEGRATION_TESTS)("@sdp/private-channels imports", () => {
  it("loads the barrel", () => {
    expect(typeof spc.createGatewayRpc).toBe("function");
    expect(typeof spc.getChannelBalance).toBe("function");
    expect(typeof spc.executeInternalTransfer).toBe("function");
    expect(typeof spc.probeGatewayHealth).toBe("function");
    expect(typeof spc.resolvePrivateChannelConfig).toBe("function");
  });

  it("loads each live subpath", () => {
    expect(typeof gateway.createGatewayRpc).toBe("function");
    expect(typeof health.probeGatewayHealth).toBe("function");
    expect(typeof balances.getChannelBalance).toBe("function");
    expect(typeof transfer.executeInternalTransfer).toBe("function");
  });
});
