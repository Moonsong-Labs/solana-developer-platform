"use client";

import type { PrivateChannelWithdrawal } from "@sdp/types";
import { CheckCircle2Icon, CircleIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { explorerTxUrl } from "@/lib/explorer";
import { useSolanaCluster } from "@/lib/use-solana-cluster";
import { cn } from "@/lib/utils";
import { fetchWithdrawalAction } from "./actions";

const RANK: Record<PrivateChannelWithdrawal["status"], number> = {
  pending: 0,
  submitted: 1,
  confirmed: 2,
  settled: 3,
  failed: -1,
};

const STAGES = [
  {
    rank: 1,
    title: "Burn sent to the channel",
    description: "Broadcasting the burn to the channel chain.",
  },
  {
    rank: 2,
    title: "Burn confirmed (balance debited)",
    description: "The burn confirmed and your channel balance was debited.",
  },
  {
    rank: 3,
    title: "Released on devnet",
    description: "The operator released the matching USDC to the destination.",
  },
] as const;

const TERMINAL: ReadonlySet<PrivateChannelWithdrawal["status"]> = new Set(["settled", "failed"]);
const POLL_INTERVAL_MS = 1500;

export function WithdrawProgress({
  withdrawal: initial,
  onReset,
}: {
  withdrawal: PrivateChannelWithdrawal;
  onReset: () => void;
}) {
  const [withdrawal, setWithdrawal] = useState(initial);
  const cluster = useSolanaCluster();

  useEffect(() => {
    setWithdrawal(initial);
  }, [initial]);

  useEffect(() => {
    if (TERMINAL.has(withdrawal.status)) {
      return;
    }
    let active = true;
    const timer = setInterval(async () => {
      const next = await fetchWithdrawalAction(withdrawal.id);
      if (active && next) {
        setWithdrawal(next);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [withdrawal.id, withdrawal.status]);

  const rank = RANK[withdrawal.status];
  const failed = withdrawal.status === "failed";
  const settled = withdrawal.status === "settled";
  const terminal = failed || settled;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Withdrawing</p>
          <p className="font-semibold text-lg">{withdrawal.amount} USDC</p>
        </div>
        <StatusBadge status={withdrawal.status} />
      </div>

      {failed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
          {withdrawal.failureReason ?? "The withdrawal failed."}
        </div>
      )}

      <ol className="space-y-3">
        {STAGES.map((stage) => {
          const done = rank >= stage.rank;
          const activeStage = !failed && !done && rank + 1 === stage.rank;
          return (
            <li key={stage.rank} className="flex items-start gap-3">
              <StageIcon done={done} active={activeStage} failed={failed && !done} />
              <div className="space-y-0.5">
                <p
                  className={cn(
                    "font-medium text-sm",
                    done || activeStage ? "text-foreground" : "text-muted-foreground"
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

      {withdrawal.signature && (
        <p className="text-muted-foreground text-xs">
          Burn signature: <span className="font-mono">{withdrawal.signature}</span>
        </p>
      )}

      {withdrawal.settlementRef && (
        <div>
          <a
            className="text-primary text-xs underline underline-offset-2 hover:no-underline"
            href={explorerTxUrl(withdrawal.settlementRef, cluster)}
            rel="noreferrer"
            target="_blank"
          >
            View release on Solana Explorer
          </a>
        </div>
      )}

      {terminal && (
        <div>
          <Button onClick={onReset} variant="secondary">
            New withdrawal
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

function StatusBadge({ status }: { status: PrivateChannelWithdrawal["status"] }) {
  const label: Record<PrivateChannelWithdrawal["status"], string> = {
    pending: "Pending",
    submitted: "Submitted",
    confirmed: "Burn confirmed",
    settled: "Settled",
    failed: "Failed",
  };
  const tone =
    status === "settled"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : status === "confirmed"
        ? "bg-primary/15 text-primary"
        : status === "failed"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-foreground";
  return (
    <span className={cn("rounded-full px-2.5 py-1 font-medium text-xs", tone)}>
      {label[status]}
    </span>
  );
}
