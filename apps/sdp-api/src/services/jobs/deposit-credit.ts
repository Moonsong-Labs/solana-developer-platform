/**
 * Cumulative credit attribution for Private Channel deposits.
 *
 * The gateway only exposes an aggregate channel balance per (recipient, mint), so
 * a single balance increase must not be counted toward more than one deposit.
 * `planDepositCredits` walks a recipient's deposits oldest-first and credits a
 * `confirmed` deposit only when the observed balance covers the cumulative
 * threshold up to and including it.
 *
 * Pure + deterministic — unit-tested in `deposit-credit.node.test.ts`.
 */

import { parseDecimalAmount } from "@sdp/solana/amount";
import type { PrivateChannelDepositRow } from "@/db/repositories";

export type DepositForCredit = Pick<
  PrivateChannelDepositRow,
  "id" | "status" | "amount" | "baseline_credited"
>;

/**
 * Decide which `confirmed` deposits to credit from a single aggregate balance.
 *
 * `deposits` are all deposits for one (recipient, mint), oldest first. Starting
 * from the balance floor before the group's first deposit, each non-failed
 * deposit's amount is added to a running threshold; a `confirmed` deposit is
 * credited only when `balance >= threshold` through it. So two concurrent
 * deposits of N both baselined at 0 need a balance of 2N before both credit —
 * never crediting both off a single N increase. Walking stops at the first
 * deposit that can't yet be credited, or at an in-flight (prepared/submitted)
 * deposit ahead in the queue.
 */
export function planDepositCredits(
  deposits: DepositForCredit[],
  balance: bigint,
  decimals: number
): string[] {
  // Failed deposits moved no funds and aren't part of the balance.
  const active = deposits.filter((deposit) => deposit.status !== "failed");
  if (active.length === 0) {
    return [];
  }

  let needed = BigInt(active[0].baseline_credited);
  const toCredit: string[] = [];

  for (const deposit of active) {
    needed += parseDecimalAmount(deposit.amount, decimals);

    if (deposit.status === "credited") {
      // Already credited — its amount is already reflected in the balance/threshold.
      continue;
    }
    if (deposit.status !== "confirmed") {
      // An in-flight (prepared/submitted) deposit ahead in the queue: we can't
      // attribute balance past it yet. Stop — later deposits need even more.
      break;
    }
    if (balance >= needed) {
      toCredit.push(deposit.id); // still counted in `needed` for later deposits.
    } else {
      break; // and everything after this needs at least this much.
    }
  }

  return toCredit;
}
