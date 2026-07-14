import type { PrivateChannelInstance, PrivateChannelInstanceOverview } from "@sdp/types";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad";

const DOT: Record<Tone, string> = {
  ok: "bg-status-success-text",
  warn: "bg-status-warning-text",
  bad: "bg-status-error-text",
};

function StatusInline({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("inline-block size-2 rounded-full", DOT[tone])} />
      <span>{label}</span>
    </span>
  );
}

function Row({
  label,
  primary,
  detail,
}: {
  label: string;
  primary: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 py-3">
      <dt className="text-sm text-text-medium">{label}</dt>
      <dd className="min-w-0 space-y-1 text-right">
        <div className="break-all font-mono text-sm text-text-extra-high">{primary}</div>
        {detail ? <div className="text-xs text-text-medium">{detail}</div> : null}
      </dd>
    </div>
  );
}

function gatewayStatus(health: PrivateChannelInstanceOverview["gateway"]["health"]) {
  if (health.status === "ready") return { tone: "ok" as const, label: "ready" };
  if (health.status === "degraded") {
    return { tone: "warn" as const, label: `degraded — ${health.reason}` };
  }
  return { tone: "bad" as const, label: `unreachable — ${health.error}` };
}

function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

interface Props {
  instance: PrivateChannelInstance;
  overview: PrivateChannelInstanceOverview;
}

export function InstanceOverviewCard({ instance, overview }: Props) {
  const { gateway, chainRpc, escrowInstance, escrowProgram, auth } = overview;
  const gw = gatewayStatus(gateway.health);

  return (
    <dl className="divide-y divide-border-extra-light">
      <Row label="Gateway" primary={<StatusInline tone={gw.tone} label={gw.label} />} />

      <Row
        label="Solana version"
        primary={
          chainRpc.ok
            ? chainRpc.solanaVersion
              ? `v${chainRpc.solanaVersion}`
              : "—"
            : <StatusInline tone="bad" label={chainRpc.error} />
        }
      />

      <Row
        label="Slot"
        primary={gateway.channelSlot !== null ? gateway.channelSlot.toLocaleString() : "—"}
      />

      <Row
        label="Latest blockhash"
        primary={gateway.latestBlockhash ?? "—"}
      />

      <Row
        label="Escrow instance"
        primary={instance.escrowInstanceAddr}
        detail={
          escrowInstance.present ? (
            <span>
              {formatSol(escrowInstance.lamports)}
              {escrowInstance.ownerMatchesProgram ? null : " · owner mismatch"}
            </span>
          ) : (
            <StatusInline tone="bad" label={escrowInstance.error} />
          )
        }
      />

      <Row
        label="Escrow program"
        primary={instance.escrowProgramId}
        detail={
          escrowProgram.present ? (
            <StatusInline
              tone={escrowProgram.executable ? "ok" : "warn"}
              label={escrowProgram.executable ? "on-chain" : "not executable"}
            />
          ) : (
            <StatusInline tone="bad" label={escrowProgram.error} />
          )
        }
      />

      {auth ? (
        <Row
          label="Auth service"
          primary={
            <StatusInline
              tone={auth.reachable ? "ok" : "bad"}
              label={auth.reachable ? "reachable" : (auth.error ?? "unreachable")}
            />
          }
        />
      ) : null}
    </dl>
  );
}
