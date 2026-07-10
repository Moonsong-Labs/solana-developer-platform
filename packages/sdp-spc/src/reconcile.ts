/**
 * Reconciliation — the settlement read path.
 *
 * The authoritative reconciler reads the operator's indexer Postgres replica by
 * `trace_id` (the 8-state machine + `counterpart_signature`). That impl is
 * NODE/DB-bound and is therefore APP-OWNED
 * (`apps/sdp-api/src/services/private-channels/reconciliation/`), never shipped
 * here — this package stays Worker-safe.
 *
 * This module ships only the interface plus a Worker-safe RPC-poll fallback that
 * watches a counterpart signature to finality when the indexer DB is not
 * available.
 */

import { getSignatureStatuses, type Signature, type SolanaRpc } from "@sdp/rpc/solana";

/** Settlement outcome for one signature. */
export interface ReconcileResult {
  /** The signature that was polled. */
  signature: string;
  /** `completed` on success, `failed` on tx error, `pending` if not yet resolved. */
  status: "completed" | "failed" | "pending";
  /** The transaction error when `status === "failed"`, else null. */
  err: unknown;
}

/** The settlement read contract; implemented by the RPC fallback and the app-owned DB reconciler. */
export interface SpcReconciler {
  /** Resolve settlement by the counterpart (settled-leg) signature. */
  bySignature(signature: string): Promise<ReconcileResult>;
}

/**
 * Fallback reconciler: poll `getSignatureStatuses` on the counterpart signature.
 * Worker-safe (no DB). Prefer the app-owned Postgres reconciler when the indexer
 * replica is reachable.
 */
export class RpcPollReconciler implements SpcReconciler {
  /** Max poll attempts before giving up (returns `pending`). */
  private readonly maxAttempts: number;
  /** Delay between poll attempts, in ms. */
  private readonly delayMs: number;

  /**
   * @param rpc RPC client to poll (gateway or L1, per the leg).
   * @param options `maxAttempts` (default 30) and `delayMs` (default 1000).
   */
  constructor(
    private readonly rpc: SolanaRpc,
    options?: { maxAttempts?: number; delayMs?: number }
  ) {
    this.maxAttempts = options?.maxAttempts ?? 30;
    this.delayMs = options?.delayMs ?? 1_000;
  }

  /** Poll the signature to finality; resolves `completed`/`failed`/`pending`. */
  async bySignature(signature: string): Promise<ReconcileResult> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const [status] = await getSignatureStatuses(this.rpc, [signature as Signature]);
      if (status) {
        if (status.err) {
          return { signature, status: "failed", err: status.err };
        }
        if (
          status.confirmationStatus === "finalized" ||
          status.confirmationStatus === "confirmed"
        ) {
          return { signature, status: "completed", err: null };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return { signature, status: "pending", err: null };
  }
}
