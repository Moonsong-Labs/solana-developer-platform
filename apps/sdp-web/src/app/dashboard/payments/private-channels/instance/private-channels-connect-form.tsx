"use client";

import {
  type ConnectionProbeResult,
  privateChannelInstanceInputSchema,
  SANDBOX_DEFAULTS,
} from "@sdp/private-channels";
import type { PrivateChannelInstance, PrivateChannelInstanceInput } from "@sdp/types";
import { Loader2Icon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  type ConnectPrivateChannelResult,
  connectPrivateChannelAction,
  deletePrivateChannelAction,
  disconnectPrivateChannelAction,
  type FieldErrors,
  testConnectionAction,
} from "./actions";

type FormValues = PrivateChannelInstanceInput;

interface Props {
  initialInstance: PrivateChannelInstance | null;
  canManage: boolean;
}

const GATEWAY_DOT: Record<"ready" | "degraded" | "unreachable", string> = {
  ready: "bg-status-success-text",
  degraded: "bg-status-warning-text",
  unreachable: "bg-status-error-text",
};
const GATEWAY_TEXT: Record<"ready" | "degraded" | "unreachable", string> = {
  ready: "text-status-success-text",
  degraded: "text-status-warning-text",
  unreachable: "text-status-error-text",
};

function toValues(instance: PrivateChannelInstance | null): FormValues {
  if (!instance) return { ...SANDBOX_DEFAULTS };
  return {
    gatewayUrl: instance.gatewayUrl,
    chainRpcUrl: instance.chainRpcUrl,
    escrowProgramId: instance.escrowProgramId,
    withdrawProgramId: instance.withdrawProgramId,
    escrowInstanceAddr: instance.escrowInstanceAddr,
    useAuth: instance.useAuth,
    authUrl: instance.authUrl,
  };
}

export function PrivateChannelsConnectForm({ initialInstance, canManage }: Props) {
  const [instance, setInstance] = useState<PrivateChannelInstance | null>(initialInstance);
  const [values, setValues] = useState<FormValues>(() => toValues(initialInstance));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [gatewayResult, setGatewayResult] = useState<ConnectionProbeResult["gateway"] | null>(null);
  const [rpcResult, setRpcResult] = useState<ConnectionProbeResult["rpc"] | null>(null);
  const [isTesting, startTesting] = useTransition();
  const [isConnecting, startConnecting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [reactivatePrompt, setReactivatePrompt] = useState<{
    existing: PrivateChannelInstance;
    message: string;
  } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const isLocked = instance?.isActive === true;
  const controlsLocked = isLocked || !canManage;
  const busy = isTesting || isConnecting || isDisconnecting || isDeleting;

  const parsed = useMemo(() => privateChannelInstanceInputSchema.safeParse(values), [values]);
  const isValid = parsed.success;

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    if (controlsLocked) return;
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    // Any edit invalidates the last probe result.
    setGatewayResult(null);
    setRpcResult(null);
  };

  const applyConnectResult = (result: ConnectPrivateChannelResult) => {
    if (result.ok) {
      setInstance(result.instance);
      setValues(toValues(result.instance));
      setErrors({});
      setGatewayResult(null);
      setRpcResult(null);
      toast.success("Private channel connected.");
      return;
    }
    if (result.kind === "validation") {
      setErrors(result.fieldErrors);
      return;
    }
    if (result.kind === "probe") {
      setGatewayResult(result.probe.gateway);
      setRpcResult(result.probe.rpc);
      toast.error(result.message);
      return;
    }
    if (result.kind === "requires-reactivate-confirmation") {
      setReactivatePrompt({ existing: result.existingInstance, message: result.message });
      return;
    }
    if (result.kind === "conflict-active") {
      // Shouldn't hit unless another tab connected concurrently — reflect state and stop.
      setInstance(result.activeInstance);
      setValues(toValues(result.activeInstance));
      toast.error(result.message);
      return;
    }
    toast.error(result.message);
  };

  const runTest = () => {
    startTesting(async () => {
      const result = await testConnectionAction({
        gatewayUrl: values.gatewayUrl,
        chainRpcUrl: values.chainRpcUrl,
      });
      setGatewayResult(result.gateway);
      setRpcResult(result.rpc);
    });
  };

  const runConnect = (confirmReactivate = false) => {
    startConnecting(async () => {
      const result = await connectPrivateChannelAction({ ...values, confirmReactivate });
      applyConnectResult(result);
    });
  };

  const runDisconnect = () => {
    startDisconnecting(async () => {
      const result = await disconnectPrivateChannelAction();
      if (result.ok) {
        setInstance(result.instance);
        setValues(toValues(result.instance));
        toast.success("Private channel disconnected. You can edit and reconnect.");
      } else {
        toast.error(result.message);
      }
    });
  };

  const runDelete = () => {
    startDeleting(async () => {
      const result = await deletePrivateChannelAction();
      if (result.ok) {
        setInstance(null);
        setValues({ ...SANDBOX_DEFAULTS });
        setGatewayResult(null);
        setRpcResult(null);
        setShowDelete(false);
        toast.success("Private channel instance deleted.");
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="grid gap-6">
      <UrlField
        id="gateway-url"
        label="Gateway URL"
        placeholder="http://gateway.example:8899"
        value={values.gatewayUrl}
        error={errors.gatewayUrl}
        disabled={controlsLocked}
        onChange={(v) => update("gatewayUrl", v)}
        status={gatewayStatus(gatewayResult)}
      />

      <UrlField
        id="chain-rpc-url"
        label="Chain RPC URL"
        placeholder="https://devnet.helius-rpc.com/?api-key=…"
        value={values.chainRpcUrl}
        error={errors.chainRpcUrl}
        disabled={controlsLocked}
        onChange={(v) => update("chainRpcUrl", v)}
        status={rpcStatus(rpcResult)}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          id="escrow-program-id"
          label="Escrow program ID"
          value={values.escrowProgramId}
          error={errors.escrowProgramId}
          disabled={controlsLocked}
          onChange={(v) => update("escrowProgramId", v)}
        />
        <TextField
          id="withdraw-program-id"
          label="Withdraw program ID"
          value={values.withdrawProgramId}
          error={errors.withdrawProgramId}
          disabled={controlsLocked}
          onChange={(v) => update("withdrawProgramId", v)}
        />
      </div>

      <TextField
        id="escrow-instance-addr"
        label="Escrow instance address"
        value={values.escrowInstanceAddr}
        error={errors.escrowInstanceAddr}
        disabled={controlsLocked}
        onChange={(v) => update("escrowInstanceAddr", v)}
      />

      <div className="grid gap-2">
        <label
          className="inline-flex items-center gap-2 text-sm font-medium text-text-high"
          htmlFor="use-auth"
        >
          <input
            id="use-auth"
            type="checkbox"
            checked={values.useAuth}
            onChange={(e) => update("useAuth", e.currentTarget.checked)}
            disabled={controlsLocked}
            className="h-4 w-4"
          />
          Use auth
        </label>
        {values.useAuth ? (
          <UrlField
            id="auth-url"
            label="Auth URL"
            placeholder="http://auth.example:8903"
            value={values.authUrl}
            error={errors.authUrl}
            disabled={controlsLocked}
            onChange={(v) => update("authUrl", v)}
          />
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={runTest} disabled={busy || isLocked}>
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
          {isLocked ? (
            <>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowDelete(true)}
                disabled={busy}
              >
                Delete
              </Button>
              <Button type="button" onClick={runDisconnect} disabled={busy}>
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => runConnect(false)} disabled={!isValid || busy}>
              {isConnecting ? "Connecting…" : "Connect"}
            </Button>
          )}
        </div>
      ) : null}

      <ReactivateConfirmationDialog
        prompt={reactivatePrompt}
        working={isConnecting}
        onCancel={() => setReactivatePrompt(null)}
        onConfirm={() => {
          setReactivatePrompt(null);
          runConnect(true);
        }}
      />

      <DeleteConfirmationDialog
        isOpen={showDelete}
        working={isDeleting}
        gatewayUrl={instance?.gatewayUrl ?? ""}
        onCancel={() => setShowDelete(false)}
        onConfirm={runDelete}
      />
    </div>
  );
}

function gatewayStatus(
  gatewayResult: ConnectionProbeResult["gateway"] | null
): StatusIndicator | null {
  if (!gatewayResult) return null;
  return {
    label:
      gatewayResult.status === "ready"
        ? "Ready"
        : gatewayResult.status === "degraded"
          ? "Degraded"
          : "Unreachable",
    dotClass: GATEWAY_DOT[gatewayResult.status],
    textClass: GATEWAY_TEXT[gatewayResult.status],
    detail:
      gatewayResult.status === "ready"
        ? `${gatewayResult.latencyMs} ms`
        : gatewayResult.status === "degraded"
          ? gatewayResult.reason
          : gatewayResult.error,
  };
}

function rpcStatus(rpcResult: ConnectionProbeResult["rpc"] | null): StatusIndicator | null {
  if (!rpcResult) return null;
  if (rpcResult.ok) {
    return {
      label: "Ready",
      dotClass: GATEWAY_DOT.ready,
      textClass: GATEWAY_TEXT.ready,
      detail: `${rpcResult.latencyMs} ms · v${rpcResult.version}`,
    };
  }
  return {
    label: "Failed",
    dotClass: GATEWAY_DOT.unreachable,
    textClass: GATEWAY_TEXT.unreachable,
    detail: rpcResult.error,
  };
}

interface StatusIndicator {
  label: string;
  dotClass: string;
  textClass: string;
  detail?: string;
}

function UrlField(props: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  status?: StatusIndicator | null;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.status ? (
          <span className={cn("inline-flex items-center gap-1.5 text-sm", props.status.textClass)}>
            <span
              aria-hidden="true"
              className={cn("inline-block size-2 rounded-full", props.status.dotClass)}
            />
            <span>{props.status.label}</span>
            {props.status.detail ? (
              <span className="text-text-medium">· {props.status.detail}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <Input
        id={props.id}
        name={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={props.disabled}
      />
      {props.error ? (
        <span className="block text-sm text-status-error-text">{props.error}</span>
      ) : null}
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        name={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={props.disabled}
      />
      {props.error ? (
        <span className="block text-sm text-status-error-text">{props.error}</span>
      ) : null}
    </div>
  );
}

function ReactivateConfirmationDialog(props: {
  prompt: { existing: PrivateChannelInstance; message: string } | null;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isOpen = props.prompt !== null;
  return (
    <Modal
      isOpen={isOpen}
      ariaLabel="Reactivate existing instance"
      onClose={props.working ? undefined : props.onCancel}
      size="sm"
    >
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight text-text-extra-high">
            Reactivate existing instance
          </h2>
          <p className="text-sm text-text-medium">
            This gateway URL has been connected to this project before. Reactivating will overwrite
            the stored config on the existing instance record. Any downstream data associated with
            it will now belong to the new configuration. Continue at your own risk.
          </p>
          {props.prompt ? (
            <p className="pt-2 text-sm text-text-medium">
              Gateway: <span className="font-medium">{props.prompt.existing.gatewayUrl}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.working}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={props.onConfirm}
            disabled={props.working}
            iconLeft={props.working ? <Loader2Icon className="animate-spin" /> : undefined}
          >
            {props.working ? "Reactivating…" : "Reactivate"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirmationDialog(props: {
  isOpen: boolean;
  working: boolean;
  gatewayUrl: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      isOpen={props.isOpen}
      ariaLabel="Delete private channel instance"
      onClose={props.working ? undefined : props.onCancel}
      size="sm"
    >
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight text-text-extra-high">
            Delete Private Channel instance
          </h2>
          <p className="text-sm text-text-medium">
            This will permanently delete the instance record and all downstream data bound to it
            (channels, deposits, transfers). This cannot be undone.
          </p>
          {props.gatewayUrl ? (
            <p className="pt-2 text-sm text-text-medium">
              Gateway: <span className="font-medium">{props.gatewayUrl}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.working}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={props.onConfirm}
            disabled={props.working}
            iconLeft={props.working ? <Loader2Icon className="animate-spin" /> : undefined}
          >
            {props.working ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
