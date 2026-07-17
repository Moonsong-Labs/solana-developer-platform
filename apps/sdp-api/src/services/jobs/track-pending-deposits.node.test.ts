import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/types/env";

// --- Mocks (hoisted so the vi.mock factories can reference them) --------------

const { depositRepo, instanceRepo, createDepositRepo, createInstanceRepo, mapInstanceRow } =
  vi.hoisted(() => {
    const depositRepo = {
      listDepositsByStatus: vi.fn(),
      listDepositsForRecipient: vi.fn(),
      updateDeposit: vi.fn(async () => null),
    };
    const instanceRepo = {
      getById: vi.fn(),
      getActiveByProject: vi.fn(),
    };
    return {
      depositRepo,
      instanceRepo,
      createDepositRepo: vi.fn(() => depositRepo),
      createInstanceRepo: vi.fn(() => instanceRepo),
      // Passthrough: getById returns instance-shaped rows in these tests.
      mapInstanceRow: vi.fn((row: unknown) => row),
    };
  });

vi.mock("@/db/repositories", () => ({
  createPrivateChannelDepositRepository: createDepositRepo,
  createPrivateChannelInstanceRepository: createInstanceRepo,
  mapPrivateChannelInstanceRow: mapInstanceRow,
}));

const { getChannelBalance } = vi.hoisted(() => ({ getChannelBalance: vi.fn() }));
vi.mock("@/services/private-channels", () => ({ getChannelBalance }));

const { createRpc, getSignatureStatuses } = vi.hoisted(() => ({
  createRpc: vi.fn(() => ({})),
  getSignatureStatuses: vi.fn(),
}));
vi.mock("@sdp/rpc/solana", () => ({ createRpc, getSignatureStatuses }));

import { trackPendingDeposits } from "./track-pending-deposits";

const NOW_ISO = "2026-07-17T00:00:00.000Z";

function depositRow(overrides: Record<string, unknown>) {
  return {
    id: "dep",
    organization_id: "org",
    project_id: "proj",
    instance_id: "inst-X",
    recipient: "recipient-1",
    mint: "mint-1",
    amount: "10",
    baseline_credited: "0",
    status: "confirmed",
    signature: "sig",
    failure_reason: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  depositRepo.listDepositsForRecipient.mockResolvedValue([]);
});

describe("trackPendingDeposits", () => {
  it("reconciles a submitted deposit against its PERSISTED instance, not the active one", async () => {
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([
      depositRow({ id: "d1", status: "submitted", signature: "sig1", instance_id: "inst-X" }),
    ]);
    // getById returns the deposit's own instance (with a distinctive chain RPC URL).
    instanceRepo.getById.mockResolvedValueOnce({ chainRpcUrl: "rpc-X", gatewayUrl: "gw-X" });
    getSignatureStatuses.mockResolvedValueOnce([{ confirmationStatus: "confirmed" }]);

    await trackPendingDeposits({} as Env);

    expect(instanceRepo.getById).toHaveBeenCalledWith("inst-X");
    expect(instanceRepo.getActiveByProject).not.toHaveBeenCalled();
    // Signature status queried against the persisted instance's chain RPC.
    expect(createRpc).toHaveBeenCalledWith(expect.anything(), { rpcUrl: "rpc-X" });
    expect(depositRepo.updateDeposit).toHaveBeenCalledWith({ id: "d1", status: "confirmed" });
  });

  it("credits only one of two concurrent confirmed deposits off a single balance increase", async () => {
    const a = depositRow({ id: "a", status: "confirmed", amount: "10" });
    const b = depositRow({ id: "b", status: "confirmed", amount: "10" });
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([a, b]);
    instanceRepo.getById.mockResolvedValue({ chainRpcUrl: "rpc-X", gatewayUrl: "gw-X" });
    depositRepo.listDepositsForRecipient.mockResolvedValueOnce([a, b]);
    // Balance rose by only one deposit's worth.
    getChannelBalance.mockResolvedValueOnce({ amount: "10", decimals: 0 });

    await trackPendingDeposits({} as Env);

    expect(depositRepo.updateDeposit).toHaveBeenCalledWith({ id: "a", status: "credited" });
    expect(depositRepo.updateDeposit).not.toHaveBeenCalledWith({ id: "b", status: "credited" });
    // Exactly one credit persisted.
    expect(depositRepo.updateDeposit).toHaveBeenCalledTimes(1);
  });

  it("credits both concurrent deposits once the balance covers their sum", async () => {
    const a = depositRow({ id: "a", status: "confirmed", amount: "10" });
    const b = depositRow({ id: "b", status: "confirmed", amount: "10" });
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([a, b]);
    instanceRepo.getById.mockResolvedValue({ chainRpcUrl: "rpc-X", gatewayUrl: "gw-X" });
    depositRepo.listDepositsForRecipient.mockResolvedValueOnce([a, b]);
    getChannelBalance.mockResolvedValueOnce({ amount: "20", decimals: 0 });

    await trackPendingDeposits({} as Env);

    expect(depositRepo.updateDeposit).toHaveBeenCalledWith({ id: "a", status: "credited" });
    expect(depositRepo.updateDeposit).toHaveBeenCalledWith({ id: "b", status: "credited" });
  });
});
