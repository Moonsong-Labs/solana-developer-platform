import * as solanaRpc from "@sdp/rpc/solana";
import type { PrivateChannelBalance } from "@sdp/types";
import {
  type Address,
  address,
  type Blockhash,
  generateKeyPairSigner,
  getBase58Codec,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Signature,
} from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreatePrivateChannelTransferInput,
  PrivateChannelTransferRepository,
  PrivateChannelTransferRow,
} from "@/db/repositories";
import * as repositories from "@/db/repositories";
import * as solanaServices from "@/services/solana";
import type { CustodyWallet } from "@/services/stores/custody-config.store";
import type { Env } from "@/types/env";
import type { SpcAuthContext } from "./auth/gateway-auth";
import * as gatewayAuthService from "./auth/gateway-auth";
import * as balanceService from "./balance";
import { buildClassicTransferInstructions, createChannelTransfer } from "./transfer";
import * as transferEvents from "./transfer-events";

const TEST_ENV = {} as Env;
const ORGANIZATION_ID = "org_transfer_test";
const PROJECT_ID = "prj_transfer_test";
const INSTANCE_ID = "pci_transfer_test";
const CHANNEL_ID = "pch_transfer_test";
const RECIPIENT_PC_USER_ID = "pcu_transfer_recipient";
const RECIPIENT_VERIFIED_WALLET_ID = "pcvw_transfer_recipient";
const GATEWAY_URL = "https://gateway.example";
const CHAIN_RPC_URL = "https://api.devnet.solana.com";
const MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SIGNATURE = "1".repeat(64) as Signature;
const GATEWAY_RPC = { kind: "gateway-rpc" };
const BLOCKHASH = getBase58Codec().decode(new Uint8Array(32).fill(7)) as Blockhash;

type TestSigner = Awaited<ReturnType<typeof generateKeyPairSigner>>;

let senderSigner: TestSigner;
let recipient: Address;
let wallet: CustodyWallet;
let auth: SpcAuthContext;
let repo: PrivateChannelTransferRepository;

function makeRow(input: CreatePrivateChannelTransferInput): PrivateChannelTransferRow {
  return {
    id: "pct_transfer_test",
    organization_id: input.organizationId,
    project_id: input.projectId,
    instance_id: input.instanceId,
    channel_id: input.channelId,
    sender_private_channel_user_id: input.senderPrivateChannelUserId,
    recipient_private_channel_user_id: input.recipientPrivateChannelUserId,
    sender_wallet_id: input.senderWalletId,
    recipient_verified_wallet_id: input.recipientVerifiedWalletId,
    sender: input.sender,
    recipient: input.recipient,
    mint: input.mint,
    amount: input.amount,
    status: input.status,
    signature: input.signature,
    failure_reason: input.failureReason,
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-28T10:00:00.000Z",
  };
}

function makeInput(overrides: Partial<Parameters<typeof createChannelTransfer>[1]> = {}) {
  return {
    instance: {
      id: INSTANCE_ID,
      gatewayUrl: GATEWAY_URL,
      chainRpcUrl: CHAIN_RPC_URL,
    },
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    channelId: CHANNEL_ID,
    wallet,
    recipient: {
      privateChannelUserId: RECIPIENT_PC_USER_ID,
      verifiedWalletId: RECIPIENT_VERIFIED_WALLET_ID,
      pubkey: recipient,
    },
    amount: "1.25",
    gatewayAuth: auth,
    ...overrides,
  };
}

function makeBalance(amount = "10000000"): PrivateChannelBalance {
  return {
    owner: senderSigner.address,
    mint: MINT,
    tokenAccount: senderSigner.address,
    amount,
    decimals: 6,
    uiAmount: "10",
  };
}

beforeEach(async () => {
  senderSigner = await generateKeyPairSigner();
  recipient = (await generateKeyPairSigner()).address;
  wallet = {
    id: "cwlt_transfer_test",
    custodyConfigId: "cust_transfer_test",
    walletId: "wallet_transfer_test",
    publicKey: senderSigner.address,
    label: "Sender",
    purpose: "transfer",
    status: "active",
    createdAt: "2026-07-28T10:00:00.000Z",
  };
  auth = {
    current: "spc-jwt",
    refresh: vi.fn(async () => "refreshed-spc-jwt"),
    pcUserId: "pcu_transfer_sender",
  };
  repo = {
    createTransfer: vi.fn(async (input: CreatePrivateChannelTransferInput) => makeRow(input)),
  } as unknown as PrivateChannelTransferRepository;

  vi.spyOn(repositories, "createPrivateChannelTransferRepository").mockReturnValue(repo);
  vi.spyOn(balanceService, "getChannelBalance").mockResolvedValue(makeBalance());
  vi.spyOn(solanaServices, "createOrgSigner").mockResolvedValue(senderSigner);
  vi.spyOn(gatewayAuthService, "withGatewayRpc").mockImplementation(
    async (_env, _gatewayUrl, _context, run) => run(GATEWAY_RPC as never)
  );
  vi.spyOn(solanaRpc, "getRecentBlockhash").mockResolvedValue({
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 100n,
  });
  vi.spyOn(solanaRpc, "sendTransaction").mockResolvedValue(SIGNATURE);
  vi.spyOn(transferEvents, "emitTransferEvent").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildClassicTransferInstructions", () => {
  it("builds an idempotent destination ATA create before a classic SPL transfer", async () => {
    const built = await buildClassicTransferInstructions({
      signer: senderSigner,
      mint: MINT,
      recipient,
      amountBaseUnits: 1_250_000n,
    });
    const [expectedSource] = await findAssociatedTokenPda({
      owner: senderSigner.address,
      mint: MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [expectedDestination] = await findAssociatedTokenPda({
      owner: recipient,
      mint: MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    expect(built.sourceTokenAccount).toBe(expectedSource);
    expect(built.destinationTokenAccount).toBe(expectedDestination);
    expect(built.instructions.map((instruction) => instruction.programAddress)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
    ]);

    const createAta = parseCreateAssociatedTokenIdempotentInstruction(built.instructions[0]);
    expect(createAta.accounts.payer.address).toBe(senderSigner.address);
    expect(createAta.accounts.ata.address).toBe(expectedDestination);

    const transfer = parseTransferInstruction(built.instructions[1]);
    expect(transfer.accounts.source.address).toBe(expectedSource);
    expect(transfer.accounts.destination.address).toBe(expectedDestination);
    expect(transfer.accounts.authority.address).toBe(senderSigner.address);
    expect(transfer.data.amount).toBe(1_250_000n);
  });
});

describe("createChannelTransfer", () => {
  it.each([
    ["malformed syntax", "1.2.3", "Invalid decimal amount"],
    ["excess default-USDC precision", "0.0000001", "Amount has too many decimal places"],
  ])("rejects %s before sending or persistence", async (_case, amount, message) => {
    await expect(createChannelTransfer(TEST_ENV, makeInput({ amount }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
    });

    expect(solanaRpc.sendTransaction).not.toHaveBeenCalled();
    expect(repo.createTransfer).not.toHaveBeenCalled();
  });

  it("rejects insufficient SPC balance before sending or persistence", async () => {
    vi.mocked(balanceService.getChannelBalance).mockResolvedValue(makeBalance("1249999"));

    await expect(createChannelTransfer(TEST_ENV, makeInput())).rejects.toMatchObject({
      code: "INSUFFICIENT_TOKEN_BALANCE",
    });

    expect(solanaRpc.sendTransaction).not.toHaveBeenCalled();
    expect(repo.createTransfer).not.toHaveBeenCalled();
  });

  it("stores a confirmed transfer only after SPC accepts it", async () => {
    const result = await createChannelTransfer(TEST_ENV, makeInput());

    expect(solanaRpc.sendTransaction).toHaveBeenCalledWith(GATEWAY_RPC, expect.any(Uint8Array));
    expect(repo.createTransfer).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      instanceId: INSTANCE_ID,
      channelId: CHANNEL_ID,
      senderPrivateChannelUserId: auth.pcUserId,
      recipientPrivateChannelUserId: RECIPIENT_PC_USER_ID,
      senderWalletId: wallet.walletId,
      recipientVerifiedWalletId: RECIPIENT_VERIFIED_WALLET_ID,
      sender: senderSigner.address,
      recipient,
      mint: MINT,
      amount: "1.25",
      status: "confirmed",
      signature: SIGNATURE,
      failureReason: null,
    });
    expect(vi.mocked(solanaRpc.sendTransaction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.createTransfer).mock.invocationCallOrder[0] ?? 0
    );
    expect(transferEvents.emitTransferEvent).toHaveBeenCalledWith(
      TEST_ENV,
      expect.objectContaining({ status: "confirmed", signature: SIGNATURE }),
      "transfer.transfer.confirmed",
      "confirmed"
    );
    expect(result).toMatchObject({ status: "confirmed", signature: SIGNATURE });

    const transaction = getTransactionDecoder().decode(
      vi.mocked(solanaRpc.sendTransaction).mock.calls[0]?.[1] as Uint8Array
    );
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    expect(transaction.signatures[senderSigner.address]).not.toBeNull();
    expect(message.version).toBe(0);
  });

  it("stores an SPC error as a failed transfer and allows a later retry", async () => {
    vi.mocked(solanaRpc.sendTransaction)
      .mockRejectedValueOnce(new Error("SPC rejected transfer"))
      .mockResolvedValueOnce(SIGNATURE);

    const failed = await createChannelTransfer(TEST_ENV, makeInput());
    const retried = await createChannelTransfer(TEST_ENV, makeInput());

    expect(failed).toMatchObject({
      status: "failed",
      failureReason: "SPC rejected transfer",
    });
    expect(retried).toMatchObject({ status: "confirmed", signature: SIGNATURE });
    expect(repo.createTransfer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "failed",
        signature: expect.any(String),
        failureReason: "SPC rejected transfer",
      })
    );
    expect(repo.createTransfer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "confirmed",
        signature: SIGNATURE,
        failureReason: null,
      })
    );
    expect(solanaRpc.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("stores a signing failure without attempting an SPC send", async () => {
    vi.mocked(solanaServices.createOrgSigner).mockResolvedValue(await generateKeyPairSigner());

    const result = await createChannelTransfer(TEST_ENV, makeInput());

    expect(result).toMatchObject({
      status: "failed",
      signature: null,
      failureReason: "Resolved signing wallet does not match the transfer wallet",
    });
    expect(solanaRpc.sendTransaction).not.toHaveBeenCalled();
    expect(repo.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        signature: null,
        failureReason: "Resolved signing wallet does not match the transfer wallet",
      })
    );
  });

  it("returns the SPC signature as confirmed when persistence fails after accept", async () => {
    vi.mocked(repo.createTransfer).mockResolvedValueOnce(null);

    const result = await createChannelTransfer(TEST_ENV, makeInput());

    expect(solanaRpc.sendTransaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "confirmed",
      signature: SIGNATURE,
      failureReason: null,
      amount: "1.25",
    });
    expect(result.id).toMatch(/^pct_/);
    expect(transferEvents.emitTransferEvent).toHaveBeenCalledWith(
      TEST_ENV,
      expect.objectContaining({ status: "confirmed", signature: SIGNATURE }),
      "transfer.transfer.confirmed",
      "confirmed"
    );
  });

  it("returns a failed terminal DTO when persistence throws after an SPC error", async () => {
    vi.mocked(solanaRpc.sendTransaction).mockRejectedValueOnce(new Error("SPC rejected transfer"));
    vi.mocked(repo.createTransfer).mockRejectedValueOnce(new Error("database unavailable"));

    const result = await createChannelTransfer(TEST_ENV, makeInput());

    expect(result).toMatchObject({
      status: "failed",
      signature: expect.any(String),
      failureReason: "SPC rejected transfer",
    });
    expect(result.id).toMatch(/^pct_/);
  });
});
