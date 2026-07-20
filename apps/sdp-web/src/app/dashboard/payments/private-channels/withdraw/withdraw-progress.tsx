"use client";

import type { PrivateChannelWithdrawal } from "@sdp/types";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchWithdrawalAction } from "./actions";

const RANK: Record<PrivateChannelWithdrawal["status"], number> = {
  pending: 0,
  submitted: 1,
  burn_confirmed: 2,
  release_pending: 3,
  released: 4,
  failed: -1,
  manual_review: -1,
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
    title: "Awaiting devnet release",
    description: "The operator is releasing the matching USDC on devnet.",
  },
  {
    rank: 4,
    title: "Released on devnet",
    description: "The operator released the USDC to the destination.",
  },
] as const;

const TERMINAL: ReadonlySet<PrivateChannelWithdrawal["status"]> = new Set([
  "released",
  "failed",
  "manual_review",
]);
const POLL_INTERVAL_MS = 1500;

export function WithdrawProgress({
  withdrawal: initial,
  onReset,
}: {
  withdrawal: PrivateChannelWithdrawal;
  onReset: () => void;
}) {
  const [withdrawal, setWithdrawal] = useState(initial);

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
  const flagged = withdrawal.status === "manual_review";
  const released = withdrawal.status === "released";
  const terminal = failed || flagged || released;

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

      {flagged && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-500">
          Flagged for manual review.{" "}
          {withdrawal.failureReason ?? "An operator will reconcile this withdrawal."}
        </div>
      )}

      <ol className="space-y-3">
        {STAGES.map((stage) => {
          const done = rank >= stage.rank;
          const activeStage = !failed && !flagged && !done && rank + 1 === stage.rank;
          return (
            <li key={stage.rank} className="flex items-start gap-3">
              <StageIcon
                done={done}
                active={activeStage}
                failed={failed && !done}
                flagged={flagged && !done}
              />
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

      {withdrawal.burnSignature && (
        <p className="text-muted-foreground text-xs">
          Burn signature: <span className="font-mono">{withdrawal.burnSignature}</span>
        </p>
      )}

      {withdrawal.releaseSignature && (
        <a
          className="inline-block text-primary text-xs underline underline-offset-2"
          href={`https://explorer.solana.com/tx/${withdrawal.releaseSignature}?cluster=devnet`}
          rel="noreferrer"
          target="_blank"
        >
          View release on devnet explorer
        </a>
      )}

      {terminal && (
        <Button onClick={onReset} variant="secondary">
          New withdrawal
        </Button>
      )}
    </div>
  );
}

function StageIcon({
  done,
  active,
  failed,
  flagged,
}: {
  done: boolean;
  active: boolean;
  failed: boolean;
  flagged: boolean;
}) {
  if (done) {
    return <CheckCircle2Icon className="mt-0.5 size-5 text-green-500" />;
  }
  if (active) {
    return <Loader2Icon className="mt-0.5 size-5 animate-spin text-primary" />;
  }
  if (failed) {
    return <XCircleIcon className="mt-0.5 size-5 text-destructive" />;
  }
  if (flagged) {
    return <AlertTriangleIcon className="mt-0.5 size-5 text-amber-500" />;
  }
  return <CircleIcon className="mt-0.5 size-5 text-muted-foreground/40" />;
}

function StatusBadge({ status }: { status: PrivateChannelWithdrawal["status"] }) {
  const label: Record<PrivateChannelWithdrawal["status"], string> = {
    pending: "Pending",
    submitted: "Submitted",
    burn_confirmed: "Burn confirmed",
    release_pending: "Releasing",
    released: "Released",
    failed: "Failed",
    manual_review: "Manual review",
  };
  const tone =
    status === "released"
      ? "bg-green-500/10 text-green-600"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : status === "manual_review"
          ? "bg-amber-500/10 text-amber-600"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2.5 py-1 font-medium text-xs", tone)}>
      {label[status]}
    </span>
  );
}
