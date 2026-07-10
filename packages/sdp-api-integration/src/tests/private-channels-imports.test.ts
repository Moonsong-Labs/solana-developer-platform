/**
 * Worker-safety guard (Codex review #7).
 *
 * Importing every `@sdp/spc` public subpath must load in the Cloudflare Workers
 * pool. If any subpath pulled a Node-only dependency (e.g. `pg`), it would fail
 * to load in workerd and this file would throw at import time. It also asserts
 * the barrel never leaks the deferred/Node-adjacent pathways.
 */

import * as spc from "@sdp/spc";
import * as auth from "@sdp/spc/auth";
import * as balances from "@sdp/spc/balances";
import * as gateway from "@sdp/spc/gateway";
import * as depositProgram from "@sdp/spc/programs/deposit";
import * as withdrawProgram from "@sdp/spc/programs/withdraw";
import * as reconcile from "@sdp/spc/reconcile";
import * as streamer from "@sdp/spc/streamer";
import * as transfer from "@sdp/spc/transfer";
import { describe, expect, it } from "vitest";
import { RUN_INTEGRATION_TESTS } from "../helpers/private-channels";

describe.skipIf(!RUN_INTEGRATION_TESTS)("@sdp/spc worker-safe imports", () => {
  it("loads the Worker-safe barrel and does not leak deferred pathways", () => {
    expect(typeof spc.createGatewayRpc).toBe("function");
    expect(typeof spc.getChannelBalance).toBe("function");
    expect(typeof spc.executeInternalTransfer).toBe("function");
    expect(typeof spc.resolveSpcConfig).toBe("function");
    // The barrel must NOT re-export the subpath-only pathways.
    expect("RpcPollReconciler" in spc).toBe(false);
    expect("createAuthClient" in spc).toBe(false);
    expect("connectStreamer" in spc).toBe(false);
  });

  it("loads each subpath without a Node-only dependency", () => {
    expect(typeof gateway.createGatewayRpc).toBe("function");
    expect(typeof balances.getChannelBalance).toBe("function");
    expect(typeof transfer.executeInternalTransfer).toBe("function");
    expect(typeof auth.createAuthClient).toBe("function");
    expect(typeof reconcile.RpcPollReconciler).toBe("function");
    expect(typeof streamer.connectStreamer).toBe("function");
    expect(typeof depositProgram.getDepositInstruction).toBe("function");
    expect(typeof withdrawProgram.getWithdrawFundsInstruction).toBe("function");
  });
});
