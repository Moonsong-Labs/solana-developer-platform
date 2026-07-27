"use client";

import type { CustodyWalletSummary, PrivateChannelDeposit } from "@sdp/types";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem } from "@/components/ui/select";
import { useTranslations } from "@/i18n/provider";
import { createDepositAction } from "./actions";
import { DepositProgress } from "./deposit-progress";

function walletLabel(wallet: CustodyWalletSummary): string {
  const short = `${wallet.publicKey.slice(0, 4)}…${wallet.publicKey.slice(-4)}`;
  return wallet.label ? `${wallet.label} (${short})` : short;
}

export function DepositForm({ wallets }: { wallets: CustodyWalletSummary[] }) {
  const [walletId, setWalletId] = useState<string>(wallets[0]?.walletId ?? "");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<PrivateChannelDeposit | null>(null);
  const [isSubmitting, startTransition] = useTransition();
  const t = useTranslations();

  if (deposit) {
    return (
      <DepositProgress
        deposit={deposit}
        onReset={() => {
          setDeposit(null);
          setAmount("");
          setRecipient("");
          setError(null);
        }}
      />
    );
  }

  if (wallets.length === 0) {
    return (
      <p className="text-secondary text-sm">{t("DashboardPrivateChannels.deposit.noWallets")}</p>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createDepositAction({
        walletId,
        amount: amount.trim(),
        recipient: recipient.trim() || undefined,
      });
      if (result.ok) {
        setDeposit(result.deposit);
        toast.success(t("DashboardPrivateChannels.deposit.submitToast"));
      } else {
        setError(result.message);
        if (result.kind === "server") {
          toast.error(result.message);
        }
      }
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="deposit-wallet">{t("DashboardPrivateChannels.deposit.fromWallet")}</Label>
        <Select onValueChange={(value) => setWalletId(value ?? "")} value={walletId}>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.walletId} value={wallet.walletId}>
              {walletLabel(wallet)}
            </SelectItem>
          ))}
        </Select>
        <p className="text-secondary text-xs">
          {t("DashboardPrivateChannels.deposit.fromWalletHelp")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit-amount">{t("DashboardPrivateChannels.common.amountUsdc")}</Label>
        <Input
          id="deposit-amount"
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t("DashboardPrivateChannels.common.amountPlaceholder")}
          value={amount}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit-recipient">{t("DashboardPrivateChannels.deposit.recipient")}</Label>
        <Input
          id="deposit-recipient"
          onChange={(event) => setRecipient(event.target.value)}
          placeholder={t("DashboardPrivateChannels.deposit.recipientPlaceholder")}
          value={recipient}
        />
        <p className="text-secondary text-xs">
          {t("DashboardPrivateChannels.deposit.recipientHelp")}
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button disabled={isSubmitting || !walletId || !amount.trim()} type="submit">
        {isSubmitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
        {t("DashboardPrivateChannels.deposit.submit")}
      </Button>
    </form>
  );
}
