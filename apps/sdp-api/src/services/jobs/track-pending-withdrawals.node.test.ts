import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/types/env";

// --- Mocks (hoisted so the vi.mock factories can reference them) --------------

const { withdrawalRepo, createWithdrawalRepo } = vi.hoisted(() => {
  const withdrawalRepo = {
    listWithdrawalsByStatus: vi.fn(),
    updateWithdrawal: vi.fn(async (input: Record<string, unknown>) => ({ ...input })),
  };
  return { withdrawalRepo, createWithdrawalRepo: vi.fn(() => withdrawalRepo) };
});
vi.mock("@/db/repositories", () => ({
  createPrivateChannelWithdrawalRepository: createWithdrawalRepo,
}));

const { createChannelGatewayRpc } = vi.hoisted(() => ({
  createChannelGatewayRpc: vi.fn(() => ({ __gateway: true })),
}));
vi.mock("@sdp/private-channels", () => ({ createChannelGatewayRpc }));

const { createRpc, getSignatureStatuses, getSignaturesForAddress, getTransaction } = vi.hoisted(
  () => ({
    createRpc: vi.fn(() => ({ __devnet: true })),
    getSignatureStatuses: vi.fn(),
    getSignaturesForAddress: vi.fn(async (): Promise<unknown[]> => []),
    getTransaction: vi.fn(async (): Promise<unknown> => null),
  })
);
vi.mock("@sdp/rpc/solana", () => ({
  createRpc,
  getSignatureStatuses,
  getSignaturesForAddress,
  getTransaction,
}));

// Deterministic ATA derivation: an owner's ATA is `ata:<owner>`.
const { findAssociatedTokenPda } = vi.hoisted(() => ({
  findAssociatedTokenPda: vi.fn(async ({ owner }: { owner: string }) => [`ata:${owner}`, 255]),
}));
vi.mock("@solana-program/token", () => ({
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
}));

const { emitWithdrawalEvent } = vi.hoisted(() => ({ emitWithdrawalEvent: vi.fn() }));
vi.mock("@/services/private-channels/withdraw-events", () => ({ emitWithdrawalEvent }));

// Gateway auth for the cron: derived from the burn owner's verified wallet. Default
// to an auth-less instance ("open"); tests override to assert the gated behaviour.
const { resolveOwnerGatewayAuth } = vi.hoisted(() => ({
  resolveOwnerGatewayAuth: vi.fn(
    async () => ({ kind: "open" }) as { kind: string; token?: string; reason?: string }
  ),
}));
vi.mock("@/services/private-channels/auth/gateway-auth", () => ({
  resolveOwnerGatewayAuth,
  gatewayAuthOptions: (token?: string) =>
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
}));

import { trackPendingWithdrawals } from "./track-pending-withdrawals";

// Valid base58 addresses (the reconciler runs `address()` on these fixtures).
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const ESCROW_INSTANCE = "7C1Pu8mbHaDDTFnGH8YTqemNDofqXP3XEotzSo6TbwHz";
const DESTINATION = "J231K9UEpS4y4KAPwGc4gsMNCjKFRMYcQBcjVW7vBhVi";
const NOW_ISO = "2026-07-17T00:00:00.000Z";
const STALE_ISO = "2026-07-16T00:00:00.000Z"; // > 30 min before NOW

function withdrawalRow(overrides: Record<string, unknown>) {
  return {
    id: "wd",
    organization_id: "org",
    project_id: "proj",
    instance_id: "inst-X",
    wallet_id: "wal-1",
    owner: ESCROW_INSTANCE,
    destination: DESTINATION,
    mint: MINT,
    amount: "10",
    gateway_url: "gw-X",
    chain_rpc_url: "https://api.devnet.solana.com",
    escrow_program_id: "esc",
    escrow_instance_addr: ESCROW_INSTANCE,
    status: "release_pending",
    burn_signature: "burnsig",
    release_signature: null,
    failure_reason: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveOwnerGatewayAuth.mockResolvedValue({ kind: "open" });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  withdrawalRepo.updateWithdrawal.mockImplementation(async (input: Record<string, unknown>) => ({
    ...input,
  }));
  getSignaturesForAddress.mockResolvedValue([]);
  getTransaction.mockResolvedValue(null);
});

describe("trackPendingWithdrawals", () => {
  it("confirms a submitted burn against its SNAPSHOT gateway (not devnet)", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "submitted", gateway_url: "gw-SNAP" }),
    ]);
    getSignatureStatuses.mockResolvedValueOnce([{ confirmationStatus: "confirmed" }]);

    await trackPendingWithdrawals({} as Env);

    expect(createChannelGatewayRpc).toHaveBeenCalledWith(expect.anything(), "gw-SNAP", undefined);
    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", status: "burn_confirmed", expectedStatus: "submitted" })
    );
  });

  it("fails a submitted burn that errored on-chain (pre-confirmation failure allowed)", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "submitted" }),
    ]);
    getSignatureStatuses.mockResolvedValueOnce([{ err: { InstructionError: [0, "Custom"] } }]);

    await trackPendingWithdrawals({} as Env);

    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", status: "failed", expectedStatus: "submitted" })
    );
  });

  it("sends the owner's SPC token when the instance is auth-enabled", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "submitted", gateway_url: "gw-SNAP" }),
    ]);
    resolveOwnerGatewayAuth.mockResolvedValue({ kind: "token", token: "jwt-xyz" });
    getSignatureStatuses.mockResolvedValueOnce([{ confirmationStatus: "confirmed" }]);

    await trackPendingWithdrawals({} as Env);

    expect(createChannelGatewayRpc).toHaveBeenCalledWith(expect.anything(), "gw-SNAP", {
      headers: { Authorization: "Bearer jwt-xyz" },
    });
    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", status: "burn_confirmed" })
    );
  });

  it("leaves a submitted burn UNTOUCHED when no SPC identity can be derived", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "submitted" }),
    ]);
    resolveOwnerGatewayAuth.mockResolvedValue({
      kind: "unavailable",
      reason: "no verified wallet",
    });

    await expect(trackPendingWithdrawals({} as Env)).resolves.toBeUndefined();

    // Never touched the gateway, and crucially NOT failed — it stays `submitted`.
    expect(getSignatureStatuses).not.toHaveBeenCalled();
    expect(withdrawalRepo.updateWithdrawal).not.toHaveBeenCalled();
  });

  it("moves burn_confirmed → release_pending (bookkeeping)", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "burn_confirmed" }),
    ]);

    await trackPendingWithdrawals({} as Env);

    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "w1",
        status: "release_pending",
        expectedStatus: "burn_confirmed",
      })
    );
  });

  it("releases a withdrawal when a matching devnet transfer is found on the instance ATA", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "release_pending" }),
    ]);
    getSignaturesForAddress.mockResolvedValueOnce([{ signature: "relSig", err: null }]);
    getTransaction.mockResolvedValueOnce({
      slot: 1n,
      err: null,
      instructions: [
        // amount "10" @ 6 decimals = 10_000_000 base units; destination = ata:<DESTINATION>
        {
          programId: "tok",
          parsedType: "transfer",
          info: { destination: `ata:${DESTINATION}`, amount: "10000000" },
        },
      ],
    });

    await trackPendingWithdrawals({} as Env);

    // Scanned the instance escrow ATA on devnet.
    expect(getSignaturesForAddress).toHaveBeenCalledWith(
      expect.anything(),
      `ata:${ESCROW_INSTANCE}`,
      expect.objectContaining({ limit: 100 })
    );
    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "w1",
        status: "released",
        releaseSignature: "relSig",
        expectedStatus: "release_pending",
      })
    );
    expect(emitWithdrawalEvent).toHaveBeenCalledTimes(1);
  });

  it("does NOT release when the transfer amount does not match", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "release_pending" }),
    ]);
    getSignaturesForAddress.mockResolvedValueOnce([{ signature: "relSig", err: null }]);
    getTransaction.mockResolvedValueOnce({
      slot: 1n,
      err: null,
      instructions: [
        {
          programId: "tok",
          parsedType: "transfer",
          info: { destination: `ata:${DESTINATION}`, amount: "9999999" },
        },
      ],
    });

    await trackPendingWithdrawals({} as Env);

    const released = withdrawalRepo.updateWithdrawal.mock.calls.some(
      ([c]) => (c as { status?: string }).status === "released"
    );
    expect(released).toBe(false);
    expect(emitWithdrawalEvent).not.toHaveBeenCalled();
  });

  it("flags a stale release_pending for manual_review (never auto-failed after burn)", async () => {
    withdrawalRepo.listWithdrawalsByStatus.mockResolvedValueOnce([
      withdrawalRow({ id: "w1", status: "release_pending", updated_at: STALE_ISO }),
    ]);
    // No matching release found (empty devnet scan).

    await trackPendingWithdrawals({} as Env);

    expect(withdrawalRepo.updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "w1",
        status: "manual_review",
        expectedStatus: "release_pending",
      })
    );
    const failed = withdrawalRepo.updateWithdrawal.mock.calls.some(
      ([c]) => (c as { status?: string }).status === "failed"
    );
    expect(failed).toBe(false);
  });
});
