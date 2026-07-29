"use client";

import type {
  CustodyWalletSummary,
  PrivateChannelMembershipChannelDto,
  PrivateChannelTransfer,
  PrivateChannelTransferRecipientDto,
} from "@sdp/types";
import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem } from "@/components/ui/select";
import { createTransferAction, fetchTransferRecipientsAction } from "./actions";
import { TransferProgress } from "./transfer-progress";
import { getTransferAmountError } from "./transfer-validation";

interface RecipientOption {
  id: string;
  label: string;
}

interface SubmittedTransfer {
  transfer: PrivateChannelTransfer;
  senderLabel?: string;
  recipientLabel?: string;
}

type RecipientLoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; recipients: PrivateChannelTransferRecipientDto[] }
  | { status: "error"; message: string };

interface TransferFormProps {
  channels: PrivateChannelMembershipChannelDto[];
  scopeKey: string;
  sourceWallets: CustodyWalletSummary[];
}

function shortenPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

function walletLabel(wallet: CustodyWalletSummary): string {
  const short = shortenPubkey(wallet.publicKey);
  return wallet.label ? `${wallet.label} (${short})` : short;
}

function flattenRecipientOptions(
  recipients: PrivateChannelTransferRecipientDto[]
): RecipientOption[] {
  return recipients.flatMap((recipient) => {
    const member = recipient.name?.trim()
      ? `${recipient.name.trim()} (${recipient.email})`
      : recipient.email;
    return recipient.wallets.map((wallet) => ({
      id: wallet.id,
      label: `${member} · ${shortenPubkey(wallet.pubkey)}`,
    }));
  });
}

export function TransferForm({ scopeKey, ...props }: TransferFormProps) {
  return <TransferFormState key={scopeKey} {...props} />;
}

function TransferFormState({ channels, sourceWallets }: Omit<TransferFormProps, "scopeKey">) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [walletId, setWalletId] = useState(sourceWallets[0]?.walletId ?? "");
  const [recipientVerifiedWalletId, setRecipientVerifiedWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [showAmountError, setShowAmountError] = useState(false);
  const [recipientLoad, setRecipientLoad] = useState<RecipientLoadState>({ status: "idle" });
  const [recipientReload, setRecipientReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submittedTransfer, setSubmittedTransfer] = useState<SubmittedTransfer | null>(null);
  const [isSubmitting, startTransition] = useTransition();
  const recipientRequest = useRef(0);
  const submitting = useRef(false);

  const recipientOptions = useMemo(
    () =>
      recipientLoad.status === "ready" ? flattenRecipientOptions(recipientLoad.recipients) : [],
    [recipientLoad]
  );

  const invalidateFinancialAttempt = () => {
    setError(null);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: recipientReload intentionally triggers a fresh server-action request.
  useEffect(() => {
    const request = ++recipientRequest.current;
    let active = true;
    setRecipientVerifiedWalletId("");

    if (!channelId || channels.length === 0 || sourceWallets.length === 0) {
      setRecipientLoad({ status: "idle" });
      return;
    }

    setRecipientLoad({ status: "loading" });
    void (async () => {
      try {
        const result = await fetchTransferRecipientsAction(channelId);
        if (!active || request !== recipientRequest.current) {
          return;
        }
        if (result.ok) {
          setRecipientLoad({ status: "ready", recipients: result.recipients });
        } else {
          setRecipientLoad({ status: "error", message: result.message });
        }
      } catch (loadError) {
        if (!active || request !== recipientRequest.current) {
          return;
        }
        setRecipientLoad({
          status: "error",
          message:
            loadError instanceof Error
              ? loadError.message
              : "Verified recipient wallets could not be loaded.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [channelId, channels.length, recipientReload, sourceWallets.length]);

  if (channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You are not a member of any active private channel. Ask a channel administrator to add you
        before making a transfer.
      </p>
    );
  }

  if (sourceWallets.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You have no verified custody wallet that SDP can sign with. Verify a provisioned wallet
        under Overview before making a transfer.
      </p>
    );
  }

  const selectedSource = sourceWallets.find((wallet) => wallet.walletId === walletId);
  const selectedRecipient = recipientOptions.find(
    (recipient) => recipient.id === recipientVerifiedWalletId
  );

  const reset = () => {
    submitting.current = false;
    setSubmittedTransfer(null);
    setChannelId(channels[0]?.id ?? "");
    setWalletId(sourceWallets[0]?.walletId ?? "");
    setRecipientVerifiedWalletId("");
    setAmount("");
    setShowAmountError(false);
    setError(null);
    setRecipientReload((value) => value + 1);
  };

  if (submittedTransfer) {
    return (
      <TransferProgress
        recipientLabel={submittedTransfer.recipientLabel}
        senderLabel={submittedTransfer.senderLabel}
        transfer={submittedTransfer.transfer}
        onReset={reset}
      />
    );
  }

  const amountError = showAmountError ? getTransferAmountError(amount) : null;

  const submit = () => {
    if (submitting.current) {
      return;
    }

    setShowAmountError(true);
    const validationMessage = getTransferAmountError(amount);
    if (validationMessage || !channelId || !walletId || !recipientVerifiedWalletId) {
      setError(
        validationMessage ??
          (!recipientVerifiedWalletId
            ? "Select a verified recipient wallet."
            : "Complete every transfer field.")
      );
      return;
    }

    const submittedLabels = {
      recipientLabel: selectedRecipient?.label,
      senderLabel: selectedSource ? walletLabel(selectedSource) : undefined,
    };
    submitting.current = true;
    setError(null);

    startTransition(async () => {
      try {
        const result = await createTransferAction({
          channelId,
          walletId,
          recipientVerifiedWalletId,
          amount: amount.trim(),
        });
        if (result.ok) {
          setSubmittedTransfer({ transfer: result.transfer, ...submittedLabels });
          if (result.transfer.status === "failed") {
            toast.error(
              result.transfer.failureReason ?? "The private-channel transfer failed to submit."
            );
          } else {
            toast.success("Transfer confirmed");
          }
        } else {
          setError(result.message);
          if (result.kind === "server") {
            toast.error(result.message);
          }
        }
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : "The transfer could not be submitted. Retry with the same details.";
        setError(message);
        toast.error(message);
      } finally {
        submitting.current = false;
      }
    });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        This transfer is signed from your selected verified wallet and can only go to another
        verified member wallet in the selected channel. Balances belong to the wallet and are shared
        across logical channels.
      </p>

      <div className="space-y-1.5">
        <Label>Channel</Label>
        <Select
          ariaLabel="Channel"
          disabled={isSubmitting}
          value={channelId}
          onValueChange={(value) => {
            if (submitting.current) return;
            const next = value ?? "";
            if (next !== channelId) {
              invalidateFinancialAttempt();
              recipientRequest.current += 1;
              setChannelId(next);
              setRecipientVerifiedWalletId("");
            }
          }}
        >
          {channels.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              {channel.name}
              {channel.isDefault ? " (Default)" : ""}
            </SelectItem>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>From verified wallet</Label>
        <Select
          ariaLabel="From verified wallet"
          disabled={isSubmitting}
          value={walletId}
          onValueChange={(value) => {
            if (submitting.current) return;
            const next = value ?? "";
            if (next !== walletId) {
              invalidateFinancialAttempt();
              setWalletId(next);
            }
          }}
        >
          {sourceWallets.map((wallet) => (
            <SelectItem key={wallet.walletId} value={wallet.walletId}>
              {walletLabel(wallet)}
            </SelectItem>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Recipient wallet</Label>
        {recipientLoad.status === "loading" && (
          <p aria-live="polite" className="text-muted-foreground text-sm" role="status">
            Loading verified recipient wallets…
          </p>
        )}
        {recipientLoad.status === "error" && (
          <div className="space-y-2" role="alert">
            <p className="text-destructive text-sm">{recipientLoad.message}</p>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                if (!submitting.current) setRecipientReload((value) => value + 1);
              }}
              type="button"
              variant="secondary"
            >
              Retry recipients
            </Button>
          </div>
        )}
        {recipientLoad.status === "ready" && recipientOptions.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No other channel member has a verified wallet eligible to receive this transfer.
          </p>
        )}
        {recipientLoad.status === "ready" && recipientOptions.length > 0 && (
          <Select
            ariaLabel="Recipient wallet"
            disabled={isSubmitting}
            value={recipientVerifiedWalletId}
            onValueChange={(value) => {
              if (submitting.current) return;
              const next = value ?? "";
              if (next !== recipientVerifiedWalletId) {
                invalidateFinancialAttempt();
                setRecipientVerifiedWalletId(next);
              }
            }}
          >
            {recipientOptions.map((recipient) => (
              <SelectItem key={recipient.id} value={recipient.id}>
                {recipient.label}
              </SelectItem>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="transfer-amount">Amount (USDC)</Label>
        <Input
          aria-describedby={amountError ? "transfer-amount-error" : "transfer-amount-help"}
          aria-invalid={Boolean(amountError)}
          autoComplete="off"
          id="transfer-amount"
          inputMode="decimal"
          min="0.000001"
          disabled={isSubmitting}
          onBlur={() => {
            if (!submitting.current) setShowAmountError(true);
          }}
          onChange={(event) => {
            if (submitting.current) return;
            if (event.target.value !== amount) {
              invalidateFinancialAttempt();
              setAmount(event.target.value);
            }
          }}
          placeholder="1.5"
          step="0.000001"
          value={amount}
        />
        {amountError ? (
          <p className="text-destructive text-xs" id="transfer-amount-error">
            {amountError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs" id="transfer-amount-help">
            Enter a positive amount with up to 6 decimal places.
          </p>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <Button
        disabled={
          isSubmitting || !channelId || !walletId || !recipientVerifiedWalletId || !amount.trim()
        }
        type="submit"
      >
        {isSubmitting && <Loader2Icon aria-hidden="true" className="mr-2 size-4 animate-spin" />}
        Transfer USDC
      </Button>
    </form>
  );
}
