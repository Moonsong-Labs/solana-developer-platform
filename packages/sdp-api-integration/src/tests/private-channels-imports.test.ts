/**
 * Import smoke test.
 *
 * Verifies the `@sdp/private-channels` barrel and its live subpaths import in the
 * Workers test pool and expose their expected entry points.
 */

import * as spc from "@sdp/private-channels";
import * as health from "@sdp/private-channels/health";
import { describe, expect, it } from "vitest";
import { RUN_INTEGRATION_TESTS } from "../helpers/private-channels";

describe.skipIf(!RUN_INTEGRATION_TESTS)("@sdp/private-channels imports", () => {
  it("loads the barrel", () => {
    expect(typeof spc.probeGatewayHealth).toBe("function");
    expect(typeof spc.resolvePrivateChannelConfig).toBe("function");
  });

  it("loads each live subpath", () => {
    expect(typeof health.probeGatewayHealth).toBe("function");
  });
});
