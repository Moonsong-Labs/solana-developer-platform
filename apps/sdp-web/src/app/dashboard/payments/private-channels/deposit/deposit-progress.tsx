"use client";

import type { PrivateChannelDeposit } from "@sdp/types";
import { CheckCircle2Icon, CircleIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { explorerTxUrl } from "@/lib/explorer";
import { useSolanaCluster } from "@/lib/use-solana-cluster";
import { cn } from "@/lib/utils";
import { fetchDepositAction } from "./actions";

const RANK: Record<PrivateChannelDeposit["status"], number> = {
  pending: 0,
  submitted: 1,
  confirmed: 2,
  // `settled` is unreachable for deposits under the chain-heuristic oracle;
  // reserved for when SPC ships an event stream.
  settled: 3,
  failed: -1,
};

const STAGES = [
  {
    rank: 1,
    title: "Sent to devnet escrow",
    description: "Broadcasting the deposit to the escrow program on devnet.",
  },
  {
    rank: 2,
    title: "Confirmed on devnet",
    description: "The deposit transaction confirmed on-chain.",
  },
] as const;

const TERMINAL: ReadonlySet<PrivateChannelDeposit["status"]> = new Set([
  "confirmed",
  "settled",
  "failed",
]);
const POLL_INTERVAL_MS = 1500;

export function DepositProgress({
  deposit: initial,
  onReset,
}: {
  deposit: PrivateChannelDeposit;
  onReset: () => void;
}) {
  const [deposit, setDeposit] = useState(initial);
  const cluster = useSolanaCluster();

  useEffect(() => {
    setDeposit(initial);
  }, [initial]);

  useEffect(() => {
    if (TERMINAL.has(deposit.status)) {
      return;
    }
    let active = true;
    const timer = setInterval(async () => {
      const next = await fetchDepositAction(deposit.id);
      if (active && next) {
        setDeposit(next);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deposit.id, deposit.status]);

  const rank = RANK[deposit.status];
  const failed = deposit.status === "failed";
  const done = deposit.status === "confirmed" || deposit.status === "settled";

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Depositing</p>
          <p className="font-semibold text-lg">{deposit.amount} USDC</p>
        </div>
        <StatusBadge status={deposit.status} />
      </div>

      {failed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
          {deposit.failureReason ?? "The deposit failed."}
        </div>
      )}

      <ol className="space-y-3">
        {STAGES.map((stage) => {
          const stageDone = rank >= stage.rank;
          const activeStage = !failed && !stageDone && rank + 1 === stage.rank;
          return (
            <li key={stage.rank} className="flex items-start gap-3">
              <StageIcon done={stageDone} active={activeStage} failed={failed && !stageDone} />
              <div className="space-y-0.5">
                <p
                  className={cn(
                    "font-medium text-sm",
                    stageDone || activeStage ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {stage.title}
                </p>
                <p className="text-muted-foreground text-xs">{stage.description}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {deposit.signature && (
        <div>
          <a
            className="text-primary text-xs underline underline-offset-2 hover:no-underline"
            href={explorerTxUrl(deposit.signature, cluster)}
            rel="noreferrer"
            target="_blank"
          >
            View transaction on Solana Explorer
          </a>
        </div>
      )}

      {(done || failed) && (
        <div>
          <Button onClick={onReset} variant="secondary">
            New deposit
          </Button>
        </div>
      )}
    </div>
  );
}

function StageIcon({ done, active, failed }: { done: boolean; active: boolean; failed: boolean }) {
  if (done) {
    return <CheckCircle2Icon className="mt-0.5 size-5 text-green-500" />;
  }
  if (active) {
    return <Loader2Icon className="mt-0.5 size-5 animate-spin text-primary" />;
  }
  if (failed) {
    return <XCircleIcon className="mt-0.5 size-5 text-destructive" />;
  }
  return <CircleIcon className="mt-0.5 size-5 text-muted-foreground/40" />;
}

function StatusBadge({ status }: { status: PrivateChannelDeposit["status"] }) {
  const label: Record<PrivateChannelDeposit["status"], string> = {
    pending: "Preparing",
    submitted: "Submitted",
    confirmed: "Confirmed",
    settled: "Settled",
    failed: "Failed",
  };
  const tone =
    status === "confirmed" || status === "settled"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-foreground";
  return (
    <span className={cn("rounded-full px-2.5 py-1 font-medium text-xs", tone)}>
      {label[status]}
    </span>
  );
}
