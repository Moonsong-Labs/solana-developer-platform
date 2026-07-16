/**
 * Background Job: Track Pending Private Channel Deposits
 *
 * Reconciles non-terminal deposits each cron tick:
 *  1. `prepared` with no signature, stuck > 5 min → failed (never broadcast).
 *  2. `submitted` with a signature → getSignatureStatuses on the instance chain →
 *     `confirmed` / `failed`; signature not found + stale → failed.
 *  3. `confirmed` → read the recipient's channel balance via the gateway; once it
 *     has risen by the deposit amount (relative to the captured baseline), mark
 *     `credited`.
 *
 * Deposits broadcast to the instance's own chain (devnet), so signature status is
 * queried against `instance.chainRpcUrl`, not the default RPC.
 */

import * as solanaRpc from "@sdp/rpc/solana";
import { parseDecimalAmount } from "@sdp/solana/amount";
import type { PrivateChannelInstance } from "@sdp/types";
import type { Signature } from "@solana/kit";
import {
  createPrivateChannelDepositRepository,
  createPrivateChannelInstanceRepository,
  mapPrivateChannelInstanceRow,
  type PrivateChannelDepositRepository,
  type PrivateChannelDepositRow,
} from "@/db/repositories";
import { getChannelBalance } from "@/services/private-channels";
import type { Env } from "@/types/env";

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

  const instanceRepo = createPrivateChannelInstanceRepository(env);
  const instanceCache = new Map<string, PrivateChannelInstance | null>();
  const loadInstance = async (
    organizationId: string,
    projectId: string
  ): Promise<PrivateChannelInstance | null> => {
    const key = `${organizationId}:${projectId}`;
    const cached = instanceCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const row = await instanceRepo.getActiveByProject({ organizationId, projectId });
    const instance = row ? mapPrivateChannelInstanceRow(row) : null;
    instanceCache.set(key, instance);
    return instance;
  };

  const now = Date.now();
  for (const deposit of pending) {
    try {
      const instance = await loadInstance(deposit.organization_id, deposit.project_id);
      // If the project's instance is gone/disconnected we can't reconcile; leave
      // the deposit as-is (a re-connect resumes reconciliation).
      if (!instance) {
        continue;
      }

      if (deposit.status === "prepared") {
        await failIfStale(repo, deposit, now, "Deposit was never broadcast.");
      } else if (deposit.status === "submitted") {
        await reconcileSubmitted(env, repo, deposit, instance, now);
      } else if (deposit.status === "confirmed") {
        await reconcileConfirmed(env, repo, deposit, instance);
      }
    } catch (err) {
      console.error("trackPendingDeposits: failed to reconcile deposit", {
        depositId: deposit.id,
        status: deposit.status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
    await repo.updateDeposit({ id: deposit.id, status: "failed", failureReason: reason });
  }
}

/** submitted → confirmed/failed via on-chain signature status. */
async function reconcileSubmitted(
  env: Env,
  repo: PrivateChannelDepositRepository,
  deposit: PrivateChannelDepositRow,
  instance: PrivateChannelInstance,
  now: number
): Promise<void> {
  if (!deposit.signature) {
    await failIfStale(repo, deposit, now, "Deposit was submitted without a signature.");
    return;
  }

  const rpc = solanaRpc.createRpc(env, { rpcUrl: instance.chainRpcUrl });
  const [status] = await solanaRpc.getSignatureStatuses(rpc, [deposit.signature as Signature]);

  if (!status) {
    // Not found on chain; if it's been a while, treat the tx as dropped.
    if (now - Date.parse(deposit.updated_at) > STUCK_AFTER_MS) {
      await repo.updateDeposit({
        id: deposit.id,
        status: "failed",
        failureReason: "Deposit transaction not found on chain.",
      });
    }
    return;
  }

  if (status.err) {
    await repo.updateDeposit({
      id: deposit.id,
      status: "failed",
      failureReason: JSON.stringify(status.err),
    });
    return;
  }

  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    await repo.updateDeposit({ id: deposit.id, status: "confirmed" });
  }
}

/** confirmed → credited once the channel balance reflects the deposit. */
async function reconcileConfirmed(
  env: Env,
  repo: PrivateChannelDepositRepository,
  deposit: PrivateChannelDepositRow,
  instance: PrivateChannelInstance
): Promise<void> {
  const balance = await getChannelBalance(env, {
    instance,
    owner: deposit.recipient,
    mint: deposit.mint,
  });

  const amountBaseUnits = parseDecimalAmount(deposit.amount, balance.decimals);
  const target = BigInt(deposit.baseline_credited) + amountBaseUnits;

  if (BigInt(balance.amount) >= target) {
    await repo.updateDeposit({ id: deposit.id, status: "credited" });
  }
}
