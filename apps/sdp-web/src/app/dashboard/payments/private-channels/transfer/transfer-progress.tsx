"use client";

import type { PrivateChannelTransfer } from "@sdp/types";
import { CheckCircle2Icon, CircleAlertIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
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
  const t = useTranslations();
  const failed = transfer.status === "failed";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">
            {t("DashboardPrivateChannels.transfer.progressLabel")}
          </p>
          <p className="font-semibold text-lg">
            {t("DashboardPrivateChannels.transfer.amountWithUnit", { amount: transfer.amount })}
          </p>
        </div>
        <StatusBadge status={transfer.status} />
      </div>

      <dl className="grid gap-4 rounded-lg border border-border-default bg-surface-sunken p-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("DashboardPrivateChannels.transfer.fromWallet")}
          </dt>
          <dd className="truncate font-medium text-sm">
            {senderLabel ?? t("DashboardPrivateChannels.transfer.senderFallback")}
          </dd>
          <dd className="break-all font-mono text-muted-foreground text-xs">{transfer.sender}</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("DashboardPrivateChannels.transfer.toMemberWallet")}
          </dt>
          <dd className="truncate font-medium text-sm">
            {recipientLabel ?? t("DashboardPrivateChannels.transfer.recipientFallback")}
          </dd>
          <dd className="break-all font-mono text-muted-foreground text-xs">
            {transfer.recipient}
          </dd>
        </div>
      </dl>

      <Outcome failureReason={transfer.failureReason} status={transfer.status} />

      {transfer.signature && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            {t("DashboardPrivateChannels.transfer.signature")}
          </p>
          <p className="break-all font-mono text-foreground">{transfer.signature}</p>
        </div>
      )}

      <Button onClick={onReset} type="button" variant="secondary">
        {failed
          ? t("DashboardPrivateChannels.transfer.tryAgain")
          : t("DashboardPrivateChannels.transfer.newTransfer")}
      </Button>
    </div>
  );
}

/**
 * Only `confirmed` reads as success. `submitted` and `pending` are deliberately
 * inconclusive: SPC accepting a transaction is not the same as executing it, and
 * neither state has a verdict yet, so neither may render as done.
 */
const OUTCOME_TONE = {
  confirmed: "success",
  submitted: "unknown",
  pending: "unknown",
  failed: "error",
} as const satisfies Record<PrivateChannelTransfer["status"], string>;

const OUTCOME_KEYS = {
  confirmed: {
    title: "DashboardPrivateChannels.transfer.stageConfirmedTitle",
    description: "DashboardPrivateChannels.transfer.stageConfirmedDescription",
  },
  submitted: {
    title: "DashboardPrivateChannels.transfer.stageSubmittedTitle",
    description: "DashboardPrivateChannels.transfer.stageSubmittedDescription",
  },
  pending: {
    title: "DashboardPrivateChannels.transfer.stagePendingTitle",
    description: "DashboardPrivateChannels.transfer.stagePendingDescription",
  },
  failed: {
    title: "DashboardPrivateChannels.transfer.stageFailedTitle",
    description: "DashboardPrivateChannels.transfer.stageFailedDescription",
  },
} as const;

const OUTCOME_STYLES = {
  success: "border-green-500/40 bg-green-500/10",
  unknown: "border-amber-500/40 bg-amber-500/10",
  error: "border-destructive/40 bg-destructive/10",
} as const;

function OutcomeIcon({ tone }: { tone: keyof typeof OUTCOME_STYLES }) {
  if (tone === "success") {
    return <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-5 text-green-500" />;
  }
  if (tone === "unknown") {
    return <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-5 text-amber-500" />;
  }
  return <XCircleIcon aria-hidden="true" className="mt-0.5 size-5 text-destructive" />;
}

function Outcome({
  failureReason,
  status,
}: {
  failureReason: string | null;
  status: PrivateChannelTransfer["status"];
}) {
  const t = useTranslations();
  const tone = OUTCOME_TONE[status];
  const keys = OUTCOME_KEYS[status];

  return (
    <div
      className={cn("flex items-start gap-3 rounded-lg border p-4", OUTCOME_STYLES[tone])}
      role={tone === "error" ? "alert" : "status"}
    >
      <OutcomeIcon tone={tone} />
      <div className="space-y-0.5">
        <p className="font-medium text-sm">{t(keys.title)}</p>
        <p
          className={cn("text-xs", tone === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          {(tone === "error" ? failureReason : null) ?? t(keys.description)}
        </p>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<PrivateChannelTransfer["status"], string> = {
  pending: "bg-amber-500/10 text-amber-600",
  submitted: "bg-amber-500/10 text-amber-600",
  confirmed: "bg-green-500/10 text-green-600",
  failed: "bg-destructive/10 text-destructive",
};

const STATUS_KEYS = {
  pending: "DashboardPrivateChannels.transfer.statusPending",
  submitted: "DashboardPrivateChannels.transfer.statusSubmitted",
  confirmed: "DashboardPrivateChannels.transfer.statusConfirmed",
  failed: "DashboardPrivateChannels.transfer.statusFailed",
} as const;

function StatusBadge({ status }: { status: PrivateChannelTransfer["status"] }) {
  const t = useTranslations();

  return (
    <span
      aria-live="polite"
      className={cn("rounded-full px-2.5 py-1 font-medium text-xs", STATUS_STYLES[status])}
      role="status"
    >
      {t(STATUS_KEYS[status])}
    </span>
  );
}
