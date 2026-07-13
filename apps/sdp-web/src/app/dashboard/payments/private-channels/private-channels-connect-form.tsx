"use client";

import { type PrivateChannelAuthMode, type PrivateChannelHealth, SANDBOX_DEFAULTS } from "@sdp/types";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { testGatewayHealthAction } from "./actions";

const STATUS_META: Record<
  PrivateChannelHealth["status"],
  { label: string; dotClass: string; textClass: string }
> = {
  ready: {
    label: "Ready",
    dotClass: "bg-status-success-text",
    textClass: "text-status-success-text",
  },
  degraded: {
    label: "Degraded",
    dotClass: "bg-status-warning-text",
    textClass: "text-status-warning-text",
  },
  unreachable: {
    label: "Unreachable",
    dotClass: "bg-status-error-text",
    textClass: "text-status-error-text",
  },
};

function statusDetail(result: PrivateChannelHealth): string | null {
  if (result.status === "ready") return null;
  if (result.status === "degraded") return result.reason;
  return result.error;
}

export function PrivateChannelsConnectForm() {
  const [gatewayUrl, setGatewayUrl] = useState<string>(SANDBOX_DEFAULTS.gatewayUrl);
  const [devnetRpcUrl, setDevnetRpcUrl] = useState<string>(SANDBOX_DEFAULTS.devnetRpcUrl);
  const [escrowProgramId, setEscrowProgramId] = useState<string>(SANDBOX_DEFAULTS.escrowProgramId);
  const [withdrawProgramId, setWithdrawProgramId] = useState<string>(
    SANDBOX_DEFAULTS.withdrawProgramId
  );
  const [escrowInstanceAddr, setEscrowInstanceAddr] = useState<string>(
    SANDBOX_DEFAULTS.escrowInstanceAddr
  );
  const [authMode, setAuthMode] = useState<PrivateChannelAuthMode>(SANDBOX_DEFAULTS.authMode);
  const [authUrl, setAuthUrl] = useState<string>(SANDBOX_DEFAULTS.authUrl);
  const [result, setResult] = useState<PrivateChannelHealth | null>(null);
  const [isTesting, startTesting] = useTransition();

  const handleTest = () => {
    startTesting(async () => {
      const next = await testGatewayHealthAction(gatewayUrl);
      setResult(next);
    });
  };

  const statusMeta = result ? STATUS_META[result.status] : null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="gateway-url">Gateway URL</Label>
          {result && statusMeta ? (
            <span className={`inline-flex items-center gap-1.5 text-sm ${statusMeta.textClass}`}>
              <span
                aria-hidden="true"
                className={`inline-block size-2 rounded-full ${statusMeta.dotClass}`}
              />
              <span>{statusMeta.label}</span>
              <span className="text-text-medium">· {result.latencyMs} ms</span>
              {statusDetail(result) ? (
                <span className="text-text-medium">· {statusDetail(result)}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
          <Input
            id="gateway-url"
            name="gatewayUrl"
            value={gatewayUrl}
            onChange={(event) => setGatewayUrl(event.currentTarget.value)}
            placeholder="http://gateway.example:8899"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full sm:w-[160px] sm:justify-center"
            onClick={handleTest}
            disabled={isTesting || gatewayUrl.trim().length === 0}
          >
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="devnet-rpc-url">Devnet RPC URL</Label>
        <Input
          id="devnet-rpc-url"
          name="devnetRpcUrl"
          value={devnetRpcUrl}
          onChange={(event) => setDevnetRpcUrl(event.currentTarget.value)}
          placeholder="https://api.devnet.solana.com"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="escrow-program-id">Escrow program ID</Label>
          <Input
            id="escrow-program-id"
            name="escrowProgramId"
            value={escrowProgramId}
            onChange={(event) => setEscrowProgramId(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="withdraw-program-id">Withdraw program ID</Label>
          <Input
            id="withdraw-program-id"
            name="withdrawProgramId"
            value={withdrawProgramId}
            onChange={(event) => setWithdrawProgramId(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="escrow-instance-addr">Escrow instance address</Label>
        <Input
          id="escrow-instance-addr"
          name="escrowInstanceAddr"
          value={escrowInstanceAddr}
          onChange={(event) => setEscrowInstanceAddr(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label htmlFor="auth-mode">Auth mode</Label>
          <select
            id="auth-mode"
            name="authMode"
            className="h-10 w-full min-w-0 rounded-lg border border-[rgba(28,28,29,0.16)] bg-white px-3 text-sm text-[#1c1c1d]"
            value={authMode}
            onChange={(event) => setAuthMode(event.currentTarget.value as PrivateChannelAuthMode)}
          >
            <option value="none">None</option>
            <option value="jwt">JWT</option>
          </select>
        </div>
        {authMode === "jwt" ? (
          <div className="grid gap-2">
            <Label htmlFor="auth-url">Auth URL</Label>
            <Input
              id="auth-url"
              name="authUrl"
              value={authUrl}
              onChange={(event) => setAuthUrl(event.currentTarget.value)}
              placeholder="http://auth.example:8903"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button type="button" disabled title="Persistence lands in the next slice">
          Connect
        </Button>
      </div>
    </div>
  );
}
