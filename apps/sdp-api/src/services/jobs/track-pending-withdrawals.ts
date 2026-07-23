/**
 * Background Job: Track Pending Private Channel Withdrawals
 *
 * Reconciles non-terminal withdrawals each cron tick:
 *  1. `pending` with no burn signature, stuck > 5 min → failed (never broadcast).
 *  2. `submitted` with a burn signature → getSignatureStatuses on the deposit's
 *     GATEWAY (channel chain) → `burn_confirmed` / `failed`; signature not found +
 *     stale → failed. This is the ONLY window where a withdrawal can auto-`failed`
 *     (pre-burn-confirmation — no balance moved yet).
 *  3. `burn_confirmed` → `release_pending` (bookkeeping: we're now awaiting the
 *     operator's devnet release; the balance is already burned).
 *  4. `release_pending` → `released` when the operator's devnet USDC release is
 *     detected on the instance escrow ATA (see `reconcileReleaseGroup`). A release
 *     not seen within the timeout → `manual_review`, NEVER `failed` (the balance is
 *     already gone — an unobservable release is a settlement problem, not a burn
 *     failure). Symmetric to the deposit "never failed after on-chain confirmation".
 *
 * Each withdrawal is reconciled against its OWN snapshotted config (`gateway_url` /
 * `chain_rpc_url` / `escrow_instance_addr` captured at intent time), NOT the
 * instance's current row — so a reconnect can't move the chain/gateway a pending
 * withdrawal is reconciled against. All status transitions are compare-and-swap
 * (`expectedStatus`) so a concurrent worker can't regress state.
 *
 * NOTE: release DETECTION matches the operator's devnet release from the instance's
 * classic-Token ATA to the destination's ATA for the mint — confirmed against a live
 * devnet release. Matching is by content `(destinationAta, mint, base-unit amount)`,
 * FIFO within the single-flight bucket, so it cannot disambiguate two withdrawals
 * sharing all three; a memo/withdrawId on the release tx would make it exact.
 */

import { createChannelGatewayRpc } from "@sdp/private-channels";
import * as solanaRpc from "@sdp/rpc/solana";
import { parseDecimalAmount } from "@sdp/solana/amount";
import { PRIVATE_CHANNEL_EVENT_TYPES } from "@sdp/types";
import { address, type Signature } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  createPrivateChannelWithdrawalRepository,
  type PrivateChannelWithdrawalRepository,
  type PrivateChannelWithdrawalRow,
} from "@/db/repositories";
import {
  gatewayAuthOptions,
  resolveOwnerGatewayAuth,
} from "@/services/private-channels/auth/gateway-auth";
import { inferCluster, knownMintDecimals } from "@/services/private-channels/mint";
import { emitWithdrawalEvent } from "@/services/private-channels/withdraw-events";
import type { Env } from "@/types/env";

const STUCK_AFTER_MS = 5 * 60 * 1000;
/** How long to wait for the operator's devnet release before flagging for review. */
const RELEASE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PER_RUN = 100;
/** How many recent instance-ATA signatures to scan for releases per group. */
const RELEASE_SCAN_LIMIT = 100;

export async function trackPendingWithdrawals(env: Env): Promise<void> {
  const repo = createPrivateChannelWithdrawalRepository(env);
  const pending = await repo.listWithdrawalsByStatus({
    statuses: ["pending", "submitted", "burn_confirmed", "release_pending"],
    limit: MAX_PER_RUN,
  });
  if (pending.length === 0) {
    return;
  }

  const now = Date.now();

  // Phase 1 — pending/submitted, per withdrawal (against its own snapshot gateway).
  for (const withdrawal of pending) {
    try {
      if (withdrawal.status === "pending") {
        await failIfStale(repo, withdrawal, now, "Withdrawal burn was never broadcast.");
      } else if (withdrawal.status === "submitted") {
        await reconcileSubmitted(env, repo, withdrawal, now);
      }
    } catch (err) {
      logReconcileError(withdrawal.id, withdrawal.status, err);
    }
  }

  // Phase 2 — burn_confirmed → release_pending (bookkeeping; enter release-watching).
  for (const withdrawal of pending) {
    if (withdrawal.status !== "burn_confirmed") {
      continue;
    }
    try {
      await repo.updateWithdrawal({
        id: withdrawal.id,
        status: "release_pending",
        expectedStatus: "burn_confirmed",
      });
    } catch (err) {
      logReconcileError(withdrawal.id, withdrawal.status, err);
    }
  }

  // Phase 3 — release_pending → released, grouped by (instance, escrow ATA, mint,
  // chain) so the instance ATA's devnet signatures are fetched once per bucket. The
  // burn_confirmed rows transitioned above are picked up on the NEXT tick.
  const groups = new Map<string, ReleaseGroup>();
  for (const withdrawal of pending) {
    if (withdrawal.status !== "release_pending") {
      continue;
    }
    const key = releaseGroupKey(withdrawal);
    const existing = groups.get(key);
    if (existing) {
      existing.withdrawals.push(withdrawal);
    } else {
      groups.set(key, {
        escrowInstanceAddr: withdrawal.escrow_instance_addr,
        mint: withdrawal.mint,
        chainRpcUrl: withdrawal.chain_rpc_url,
        withdrawals: [withdrawal],
      });
    }
  }
  for (const group of groups.values()) {
    try {
      await reconcileReleaseGroup(env, repo, group, now);
    } catch (err) {
      console.error("trackPendingWithdrawals: failed to reconcile release group", {
        escrowInstanceAddr: group.escrowInstanceAddr,
        mint: group.mint,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface ReleaseGroup {
  escrowInstanceAddr: string;
  mint: string;
  chainRpcUrl: string;
  withdrawals: PrivateChannelWithdrawalRow[];
}

function releaseGroupKey(withdrawal: PrivateChannelWithdrawalRow): string {
  return `${withdrawal.escrow_instance_addr}|${withdrawal.mint}|${withdrawal.chain_rpc_url}`;
}

function logReconcileError(withdrawalId: string, status: string, err: unknown): void {
  console.error("trackPendingWithdrawals: failed to reconcile withdrawal", {
    withdrawalId,
    status,
    error: err instanceof Error ? err.message : String(err),
  });
}

/** Fail a burn-signature-less withdrawal that has been stuck past the threshold. */
async function failIfStale(
  repo: PrivateChannelWithdrawalRepository,
  withdrawal: PrivateChannelWithdrawalRow,
  now: number,
  reason: string
): Promise<void> {
  if (withdrawal.burn_signature) {
    return;
  }
  if (now - Date.parse(withdrawal.updated_at) > STUCK_AFTER_MS) {
    await repo.updateWithdrawal({
      id: withdrawal.id,
      status: "failed",
      failureReason: reason,
      expectedStatus: withdrawal.status,
    });
  }
}

/** submitted → burn_confirmed/failed via the burn's gateway signature status. */
async function reconcileSubmitted(
  env: Env,
  repo: PrivateChannelWithdrawalRepository,
  withdrawal: PrivateChannelWithdrawalRow,
  now: number
): Promise<void> {
  if (!withdrawal.burn_signature) {
    await failIfStale(repo, withdrawal, now, "Withdrawal was submitted without a burn signature.");
    return;
  }

  // The gateway JWT-gates signature reads. The cron has no request user, so derive
  // the SPC identity from the burn OWNER's verified wallet (same mechanism deposits
  // use for the credit recipient). `unavailable` — e.g. an unverified owner — leaves
  // the withdrawal `submitted` for a later tick / manual resolution. It must NOT be
  // auto-failed: we can't tell whether the burn confirmed, and after burn_confirmed
  // the balance is already gone.
  const gatewayAuth = await resolveOwnerGatewayAuth(env, {
    organizationId: withdrawal.organization_id,
    projectId: withdrawal.project_id,
    instanceId: withdrawal.instance_id,
    owner: withdrawal.owner,
  });
  if (gatewayAuth.kind === "unavailable") {
    console.warn("trackPendingWithdrawals: skipping burn confirmation, gateway auth unavailable", {
      withdrawalId: withdrawal.id,
      owner: withdrawal.owner,
      reason: gatewayAuth.reason,
    });
    return;
  }

  // Query the snapshotted GATEWAY — the burn lives on the channel chain.
  const gatewayRpc = createChannelGatewayRpc(
    env,
    withdrawal.gateway_url,
    gatewayAuthOptions(gatewayAuth.token)
  );
  const [status] = await solanaRpc.getSignatureStatuses(gatewayRpc, [
    withdrawal.burn_signature as Signature,
  ]);

  if (!status) {
    // Not found on chain; if it's been a while, treat the burn as dropped. This is
    // pre-confirmation, so `failed` is legitimate (the balance never moved).
    if (now - Date.parse(withdrawal.updated_at) > STUCK_AFTER_MS) {
      await repo.updateWithdrawal({
        id: withdrawal.id,
        status: "failed",
        failureReason: "Withdrawal burn not found on chain.",
        expectedStatus: "submitted",
      });
    }
    return;
  }

  if (status.err) {
    await repo.updateWithdrawal({
      id: withdrawal.id,
      status: "failed",
      failureReason: JSON.stringify(status.err),
      expectedStatus: "submitted",
    });
    return;
  }

  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    await repo.updateWithdrawal({
      id: withdrawal.id,
      status: "burn_confirmed",
      expectedStatus: "submitted",
    });
  }
}

/**
 * release_pending → released for one (instance ATA, mint, chain). Scans the instance
 * escrow ATA's recent devnet signatures for outgoing transfers matching a pending
 * withdrawal's (destinationAta, mint, amount); stale withdrawals → manual_review.
 */
async function reconcileReleaseGroup(
  env: Env,
  repo: PrivateChannelWithdrawalRepository,
  group: ReleaseGroup,
  now: number
): Promise<void> {
  const withdrawals = group.withdrawals;
  if (withdrawals.length === 0) {
    return;
  }

  const cluster = inferCluster(group.chainRpcUrl);
  const decimals = knownMintDecimals(group.mint, cluster) ?? 6;
  const mint = address(group.mint);

  // The release transfers FROM the instance escrow's classic-Token ATA on devnet.
  const [vaultAta] = await findAssociatedTokenPda({
    owner: address(group.escrowInstanceAddr),
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const rpc = solanaRpc.createRpc(env, { rpcUrl: group.chainRpcUrl });
  const sigInfos = await solanaRpc.getSignaturesForAddress(rpc, vaultAta, {
    limit: RELEASE_SCAN_LIMIT,
  });

  // Collect the outgoing token transfers seen on the vault ATA: (destinationTokenAccount, baseUnits) → signature.
  const releases = await collectReleases(
    rpc,
    sigInfos.filter((s) => !s.err).map((s) => s.signature)
  );

  const claimed = new Set<string>();
  // Oldest first so concurrent same-content withdrawals settle FIFO within the bucket.
  const ordered = [...withdrawals].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const withdrawal of ordered) {
    const [destinationAta] = await findAssociatedTokenPda({
      owner: address(withdrawal.destination),
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const wantBaseUnits = parseDecimalAmount(withdrawal.amount, decimals);

    const match = releases.find(
      (r) =>
        !claimed.has(r.signature) &&
        r.destination === destinationAta &&
        r.baseUnits === wantBaseUnits
    );

    if (match) {
      claimed.add(match.signature);
      const updated = await repo.updateWithdrawal({
        id: withdrawal.id,
        status: "released",
        releaseSignature: match.signature,
        expectedStatus: "release_pending",
      });
      if (updated) {
        await emitWithdrawalEvent(
          env,
          updated,
          PRIVATE_CHANNEL_EVENT_TYPES.TRANSFER_WITHDRAWAL_RELEASED,
          "confirmed",
          { signature: match.signature }
        );
      }
    } else if (now - Date.parse(withdrawal.updated_at) > RELEASE_TIMEOUT_MS) {
      // Balance is already burned — an unobservable release is a settlement issue.
      await repo.updateWithdrawal({
        id: withdrawal.id,
        status: "manual_review",
        failureReason: "Devnet release not observed within the timeout.",
        expectedStatus: "release_pending",
      });
    }
  }
}

interface ReleaseTransfer {
  signature: Signature;
  /** Destination TOKEN ACCOUNT (ATA), as reported by the parsed transfer. */
  destination: string;
  baseUnits: bigint;
}

/** Fetch + parse each signature, extracting outgoing SPL token transfers. */
async function collectReleases(
  rpc: solanaRpc.SolanaRpc,
  signatures: Signature[]
): Promise<ReleaseTransfer[]> {
  const releases: ReleaseTransfer[] = [];
  for (const signature of signatures) {
    const tx = await solanaRpc.getTransaction(rpc, signature);
    if (!tx || tx.err) {
      continue;
    }
    for (const ix of tx.instructions) {
      const parsed = parseTokenTransfer(ix);
      if (parsed) {
        releases.push({ signature, destination: parsed.destination, baseUnits: parsed.baseUnits });
      }
    }
  }
  return releases;
}

/** Pull (destinationTokenAccount, baseUnits) from a parsed spl-token transfer ix. */
function parseTokenTransfer(
  ix: solanaRpc.ParsedInstruction
): { destination: string; baseUnits: bigint } | null {
  if (ix.parsedType !== "transfer" && ix.parsedType !== "transferChecked") {
    return null;
  }
  const info = ix.info;
  if (!info) {
    return null;
  }
  const destination = typeof info.destination === "string" ? info.destination : null;
  if (!destination) {
    return null;
  }
  // `transfer` reports a bare `amount`; `transferChecked` nests it under `tokenAmount`.
  const rawAmount =
    typeof info.amount === "string"
      ? info.amount
      : ((info.tokenAmount as { amount?: string } | undefined)?.amount ?? null);
  if (rawAmount === null) {
    return null;
  }
  let baseUnits: bigint;
  try {
    baseUnits = BigInt(rawAmount);
  } catch {
    return null;
  }
  return { destination, baseUnits };
}
