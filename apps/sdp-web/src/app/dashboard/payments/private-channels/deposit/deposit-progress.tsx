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
  prepared: 0,
  submitted: 1,
  confirmed: 2,
  credited: 3,
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
  {
    rank: 3,
    title: "Credited in the channel",
    description: "The operator credited your channel balance.",
  },
] as const;

const TERMINAL: ReadonlySet<PrivateChannelDeposit["status"]> = new Set(["credited", "failed"]);
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
  const credited = deposit.status === "credited";

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
          const done = rank >= stage.rank;
          const activeStage = !failed && !done && rank + 1 === stage.rank;
          return (
            <li key={stage.rank} className="flex items-start gap-3">
              <StageIcon done={done} active={activeStage} failed={failed && !done} />
              <div className="space-y-0.5">
                <p
                  className={cn(
                    "font-medium text-sm",
                    done
                      ? "text-foreground"
                      : activeStage
                        ? "text-foreground"
                        : "text-muted-foreground"
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
        <a
          className="inline-block text-primary text-xs underline underline-offset-2"
          href={explorerTxUrl(deposit.signature, cluster)}
          rel="noreferrer"
          target="_blank"
        >
          View transaction on Solana Explorer
        </a>
      )}

      {(credited || failed) && (
        <Button onClick={onReset} variant="secondary">
          New deposit
        </Button>
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
    prepared: "Preparing",
    submitted: "Submitted",
    confirmed: "Confirmed",
    credited: "Credited",
    failed: "Failed",
  };
  const tone =
    status === "credited"
      ? "bg-green-500/10 text-green-600"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2.5 py-1 font-medium text-xs", tone)}>
      {label[status]}
    </span>
  );
}
