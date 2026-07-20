import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/types/env";

// --- Mocks (hoisted so the vi.mock factories can reference them) --------------

const { depositRepo, createDepositRepo } = vi.hoisted(() => {
  const depositRepo = {
    listDepositsByStatus: vi.fn(),
    listDepositsForRecipient: vi.fn(),
    updateDeposit: vi.fn(async (input: Record<string, unknown>) => ({ ...input })),
  };
  return { depositRepo, createDepositRepo: vi.fn(() => depositRepo) };
});
vi.mock("@/db/repositories", () => ({ createPrivateChannelDepositRepository: createDepositRepo }));

const { getChannelBalance } = vi.hoisted(() => ({ getChannelBalance: vi.fn() }));
vi.mock("@/services/private-channels", () => ({ getChannelBalance }));

// The reconciler emits credited events via the runtime event service; mock it out.
const { emitDepositEvent } = vi.hoisted(() => ({ emitDepositEvent: vi.fn() }));
vi.mock("@/services/private-channels/deposit-events", () => ({ emitDepositEvent }));

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
    // snapshot config
    gateway_url: "gw-X",
    chain_rpc_url: "rpc-X",
    escrow_program_id: "esc",
    escrow_instance_addr: "inst-addr",
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
  depositRepo.updateDeposit.mockImplementation(async (input: Record<string, unknown>) => ({
    ...input,
  }));
});

describe("trackPendingDeposits", () => {
  it("reconciles a submitted deposit against its SNAPSHOT chain RPC (not the current instance)", async () => {
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([
      depositRow({ id: "d1", status: "submitted", signature: "sig1", chain_rpc_url: "rpc-SNAP" }),
    ]);
    getSignatureStatuses.mockResolvedValueOnce([{ confirmationStatus: "confirmed" }]);

    await trackPendingDeposits({} as Env);

    // Queried against the deposit's snapshotted chain RPC, not a re-loaded instance.
    expect(createRpc).toHaveBeenCalledWith(expect.anything(), { rpcUrl: "rpc-SNAP" });
    // CAS transition submitted -> confirmed.
    expect(depositRepo.updateDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1", status: "confirmed", expectedStatus: "submitted" })
    );
  });

  it("credits only one of two concurrent confirmed deposits off a single balance increase", async () => {
    const a = depositRow({ id: "a", status: "confirmed", amount: "10" });
    const b = depositRow({ id: "b", status: "confirmed", amount: "10" });
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([a, b]);
    depositRepo.listDepositsForRecipient.mockResolvedValueOnce([a, b]);
    // Balance rose by only one deposit's worth.
    getChannelBalance.mockResolvedValueOnce({ amount: "10", decimals: 0 });

    await trackPendingDeposits({} as Env);

    // Balance read through the group's snapshot gateway.
    expect(getChannelBalance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instance: { gatewayUrl: "gw-X", chainRpcUrl: "rpc-X" } })
    );
    expect(depositRepo.updateDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", status: "credited", expectedStatus: "confirmed" })
    );
    const creditedB = depositRepo.updateDeposit.mock.calls.some(
      ([c]) => (c as { id: string; status: string }).id === "b" && c.status === "credited"
    );
    expect(creditedB).toBe(false);
    expect(depositRepo.updateDeposit).toHaveBeenCalledTimes(1);
    expect(emitDepositEvent).toHaveBeenCalledTimes(1);
  });

  it("credits both concurrent deposits once the balance covers their sum", async () => {
    const a = depositRow({ id: "a", status: "confirmed", amount: "10" });
    const b = depositRow({ id: "b", status: "confirmed", amount: "10" });
    depositRepo.listDepositsByStatus.mockResolvedValueOnce([a, b]);
    depositRepo.listDepositsForRecipient.mockResolvedValueOnce([a, b]);
    getChannelBalance.mockResolvedValueOnce({ amount: "20", decimals: 0 });

    await trackPendingDeposits({} as Env);

    expect(depositRepo.updateDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", status: "credited" })
    );
    expect(depositRepo.updateDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b", status: "credited" })
    );
    expect(emitDepositEvent).toHaveBeenCalledTimes(2);
  });
});
