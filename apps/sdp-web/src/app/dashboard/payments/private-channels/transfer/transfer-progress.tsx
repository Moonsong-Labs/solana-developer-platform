"use client";

import type { PrivateChannelTransfer } from "@sdp/types";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TransferProgress({
  transfer,
  senderLabel,
  recipientLabel,
  onReset,
}: {
  transfer: PrivateChannelTransfer;
  senderLabel?: string;
  recipientLabel?: string;
  onReset: () => void;
}) {
  const failed = transfer.status === "failed";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">Transferring</p>
          <p className="font-semibold text-lg">{transfer.amount} USDC</p>
        </div>
        <StatusBadge status={transfer.status} />
      </div>

      <dl className="grid gap-4 rounded-lg border border-border-default bg-surface-sunken p-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <dt className="text-muted-foreground text-xs">From verified wallet</dt>
          <dd className="truncate font-medium text-sm">
            {senderLabel ?? "Verified source wallet"}
          </dd>
          <dd className="break-all font-mono text-muted-foreground text-xs">{transfer.sender}</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-muted-foreground text-xs">To verified member wallet</dt>
          <dd className="truncate font-medium text-sm">
            {recipientLabel ?? "Verified recipient wallet"}
          </dd>
          <dd className="break-all font-mono text-muted-foreground text-xs">
            {transfer.recipient}
          </dd>
        </div>
      </dl>

      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-4",
          failed
            ? "border-destructive/40 bg-destructive/10"
            : "border-green-500/40 bg-green-500/10"
        )}
        role={failed ? "alert" : "status"}
      >
        {failed ? (
          <XCircleIcon aria-hidden="true" className="mt-0.5 size-5 text-destructive" />
        ) : (
          <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-5 text-green-500" />
        )}
        <div className="space-y-0.5">
          <p className="font-medium text-sm">
            {failed ? "Transfer failed" : "Confirmed in the private channel"}
          </p>
          <p className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
            {failed
              ? (transfer.failureReason ?? "SPC rejected the transfer. You can try again.")
              : "SPC accepted the member-to-member transfer."}
          </p>
        </div>
      </div>

      {transfer.signature && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">Private gateway signature</p>
          <p className="break-all font-mono text-foreground">{transfer.signature}</p>
        </div>
      )}

      <Button onClick={onReset} type="button" variant="secondary">
        {failed ? "Try again" : "New transfer"}
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: PrivateChannelTransfer["status"] }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "rounded-full px-2.5 py-1 font-medium text-xs",
        status === "confirmed"
          ? "bg-green-500/10 text-green-600"
          : "bg-destructive/10 text-destructive"
      )}
      role="status"
    >
      {status === "confirmed" ? "Confirmed" : "Failed"}
    </span>
  );
}
