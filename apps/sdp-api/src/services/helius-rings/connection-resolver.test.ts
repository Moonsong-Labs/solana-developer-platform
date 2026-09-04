import { HeliusRingsError } from "@sdp/helius-rings";
import { describe, expect, it } from "vitest";
import type { Env } from "@/types/env";
import { resolveRingsConnection } from "./connection-resolver";

const tenant = { organizationId: "org_legacy", projectId: "prj_legacy" };
const legacyEnv = {
  HELIUS_RINGS_RPC_URL: "https://rpc.invalid",
  HELIUS_RINGS_INDEXER_URL: "https://indexer.invalid",
  HELIUS_RINGS_PROVER_URL: "https://prover.invalid",
  HELIUS_RINGS_RING_RPC_URL: "https://ring.invalid",
} as Env;

describe("resolveRingsConnection", () => {
  it("treats a null operation pin as the legacy endpoint bundle", async () => {
    await expect(
      resolveRingsConnection({ env: legacyEnv, ...tenant, connectionId: null })
    ).resolves.toMatchObject({
      id: null,
      source: "legacy_environment",
      solanaRpcUrl: "https://rpc.invalid",
      ringRpcUrl: "https://ring.invalid",
    });
  });

  it("fails explicitly when a legacy-pinned operation lost its environment bundle", async () => {
    const error = await resolveRingsConnection({
      env: {} as Env,
      ...tenant,
      connectionId: null,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HeliusRingsError);
    expect(error).toMatchObject({
      code: "config_error",
      message: "The legacy Helius Rings configuration used by this operation is unavailable",
    });
  });
});
