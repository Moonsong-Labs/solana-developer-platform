/**
 * Pending-withdrawals reconciliation entrypoint, runtime-neutral.
 *
 * Mirrors `pending-deposits`: wraps `trackPendingWithdrawals` with a Sentry cron
 * monitor when observability is supplied and hands the promise to the
 * BackgroundRunner. Called by both the CF `scheduled` handler and the Node
 * `node-cron` tick, gated on the Private Channels feature flag.
 */

import type { BackgroundRunner } from "@/runtime/background";
import type { Observability } from "@/runtime/observability";
import { trackPendingWithdrawals } from "@/services/jobs/track-pending-withdrawals";
import type { Env } from "@/types/env";

export const PENDING_WITHDRAWALS_MONITOR = "sdp-api-track-pending-withdrawals";
export const PENDING_WITHDRAWALS_CRON = "* * * * *";

export interface PendingWithdrawalsReconciliationDeps {
  env: Env;
  bg: BackgroundRunner;
  observability?: Observability;
}

export function runPendingWithdrawalsReconciliation(
  deps: PendingWithdrawalsReconciliationDeps
): void {
  const work = () => trackPendingWithdrawals(deps.env);

  // Never invoke `work` eagerly — a sync throw before the first await must become
  // a rejected promise the BackgroundRunner can track, not propagate to the
  // runtime entrypoint.
  const promise = deps.observability
    ? deps.observability.withMonitor(PENDING_WITHDRAWALS_MONITOR, work, {
        schedule: { type: "crontab", value: PENDING_WITHDRAWALS_CRON },
      })
    : Promise.resolve().then(work);

  deps.bg.run(promise);
}
