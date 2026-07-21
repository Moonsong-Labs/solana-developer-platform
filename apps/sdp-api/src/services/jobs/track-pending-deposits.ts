/**
 * Background Job: Track Pending Private Channel Deposits
 *
 * Reconciles non-terminal deposits each cron tick:
 *  1. `prepared` with no signature, stuck > 5 min → failed (never broadcast).
 *  2. `submitted` with a signature → getSignatureStatuses on the deposit's chain →
 *     `confirmed` / `failed`; signature not found + stale → failed.
 *  3. `confirmed` → credited, grouped per (instance, recipient, mint) with cumulative
 *     accounting (see `planDepositCredits`).
 *
 * Each deposit is reconciled against its OWN snapshotted config (`chain_rpc_url` /
 * `gateway_url` captured at intent time), NOT the instance's current row — so a
 * reconnect that changes the instance config can't move the chain/gateway a pending
 * deposit is reconciled against. All status transitions are compare-and-swap
 * (`expectedStatus`) so a concurrent worker can't regress state, and each terminal
 * credit emits a `transfer.deposit.credited` activity event.
 */

import * as solanaRpc from "@sdp/rpc/solana";
import type { Signature } from "@solana/kit";
import {
  createPrivateChannelDepositRepository,
  type PrivateChannelDepositRepository,
  type PrivateChannelDepositRow,
} from "@/db/repositories";
import { getChannelBalance } from "@/services/private-channels";
import { emitDepositEvent } from "@/services/private-channels/deposit-events";
import type { Env } from "@/types/env";
import { planDepositCredits } from "./deposit-credit";

const STUCK_AFTER_MS = 5 * 60 * 1000;
const MAX_PER_RUN = 100;

export async function trackPendingDeposits(env: Env): Promise<void> {
  const repo = createPrivateChannelDepositRepository(env);
  const pending = await repo.listDepositsByStatus({
    statuses: ["prepared", "submitted", "confirmed"],
    limit: MAX_PER_RUN,
  });
  if (pending.length === 0) {
    return;
  }

  const now = Date.now();

  // Phase 1 — prepared/submitted, per deposit (against its own snapshot config).
  for (const deposit of pending) {
    if (deposit.status === "confirmed") {
      continue; // handled by the grouped credit pass below.
    }
    try {
      if (deposit.status === "prepared") {
        await failIfStale(repo, deposit, now, "Deposit was never broadcast.");
      } else if (deposit.status === "submitted") {
        await reconcileSubmitted(env, repo, deposit, now);
      }
    } catch (err) {
      logReconcileError(deposit.id, deposit.status, err);
    }
  }

  // Phase 2 — confirmed → credited, grouped by (instance, recipient, mint) so the
  // aggregate balance is never double-attributed across concurrent deposits.
  const groups = new Map<string, DepositCreditGroup>();
  for (const deposit of pending) {
    if (deposit.status !== "confirmed") {
      continue;
    }
    const key = creditGroupKey(deposit);
    if (!groups.has(key)) {
      groups.set(key, {
        instanceId: deposit.instance_id,
        recipient: deposit.recipient,
        mint: deposit.mint,
      });
    }
  }
  for (const group of groups.values()) {
    try {
      await reconcileCreditGroup(env, repo, group);
    } catch (err) {
      console.error("trackPendingDeposits: failed to reconcile credit group", {
        instanceId: group.instanceId,
        recipient: group.recipient,
        mint: group.mint,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface DepositCreditGroup {
  instanceId: string;
  recipient: string;
  mint: string;
}

function creditGroupKey(deposit: PrivateChannelDepositRow): string {
  return `${deposit.instance_id}|${deposit.recipient}|${deposit.mint}`;
}

function logReconcileError(depositId: string, status: string, err: unknown): void {
  console.error("trackPendingDeposits: failed to reconcile deposit", {
    depositId,
    status,
    error: err instanceof Error ? err.message : String(err),
  });
}

/** Fail a signature-less deposit that has been stuck past the threshold. */
async function failIfStale(
  repo: PrivateChannelDepositRepository,
  deposit: PrivateChannelDepositRow,
  now: number,
  reason: string
): Promise<void> {
  if (deposit.signature) {
    return;
  }
  if (now - Date.parse(deposit.updated_at) > STUCK_AFTER_MS) {
    await repo.updateDeposit({
      id: deposit.id,
      status: "failed",
      failureReason: reason,
      expectedStatus: deposit.status,
    });
  }
}

/** submitted → confirmed/failed via on-chain signature status (deposit's own chain). */
async function reconcileSubmitted(
  env: Env,
  repo: PrivateChannelDepositRepository,
  deposit: PrivateChannelDepositRow,
  now: number
): Promise<void> {
  if (!deposit.signature) {
    await failIfStale(repo, deposit, now, "Deposit was submitted without a signature.");
    return;
  }

  // Query the snapshotted chain RPC — not the instance's (possibly-changed) current one.
  const rpc = solanaRpc.createRpc(env, { rpcUrl: deposit.chain_rpc_url });
  const [status] = await solanaRpc.getSignatureStatuses(rpc, [deposit.signature as Signature]);

  if (!status) {
    // Not found on chain; if it's been a while, treat the tx as dropped.
    if (now - Date.parse(deposit.updated_at) > STUCK_AFTER_MS) {
      await repo.updateDeposit({
        id: deposit.id,
        status: "failed",
        failureReason: "Deposit transaction not found on chain.",
        expectedStatus: "submitted",
      });
    }
    return;
  }

  if (status.err) {
    await repo.updateDeposit({
      id: deposit.id,
      status: "failed",
      failureReason: JSON.stringify(status.err),
      expectedStatus: "submitted",
    });
    return;
  }

  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    await repo.updateDeposit({ id: deposit.id, status: "confirmed", expectedStatus: "submitted" });
  }
}

/** confirmed → credited for one (instance, recipient, mint), cumulative. */
async function reconcileCreditGroup(
  env: Env,
  repo: PrivateChannelDepositRepository,
  group: DepositCreditGroup
): Promise<void> {
  const deposits = await repo.listDepositsForRecipient(group);
  if (deposits.length === 0) {
    return;
  }

  // Read the recipient's channel balance via the group's snapshotted gateway.
  //
  // TODO(gateway-auth): this read is UNAUTHENTICATED and will 401 on an
  // auth-enabled instance, stalling credit detection at `confirmed`. The request
  // paths mint the caller's SPC session (`resolveGatewayAuthToken`), but the cron
  // has no user identity, so it has no member to log in as. Resolving it needs a
  // deliberate choice of SPC identity — e.g. map the recipient pubkey back to its
  // member via `private_channel_verified_wallets` (needs a by-pubkey lookup, which
  // that repository doesn't expose yet) or introduce a service/operator SPC user.
  // Track with the settlement-ledger rework; see DEPOSIT_REVIEW_FIXES.md.
  const snapshot = deposits[0];
  const balance = await getChannelBalance(env, {
    instance: { gatewayUrl: snapshot.gateway_url, chainRpcUrl: snapshot.chain_rpc_url },
    owner: group.recipient,
    mint: group.mint,
  });

  const toCredit = planDepositCredits(deposits, BigInt(balance.amount), balance.decimals);
  for (const id of toCredit) {
    const updated = await repo.updateDeposit({
      id,
      status: "credited",
      expectedStatus: "confirmed",
    });
    if (updated) {
      await emitDepositEvent(env, updated, "transfer.deposit.credited", "confirmed");
    }
  }
}
