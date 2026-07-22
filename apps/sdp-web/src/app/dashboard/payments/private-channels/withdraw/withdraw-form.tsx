"use client";

import type { CustodyWalletSummary, PrivateChannelWithdrawal } from "@sdp/types";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem } from "@/components/ui/select";
import { createWithdrawalAction } from "./actions";
import { WithdrawProgress } from "./withdraw-progress";

function walletLabel(wallet: CustodyWalletSummary): string {
  const short = `${wallet.publicKey.slice(0, 4)}…${wallet.publicKey.slice(-4)}`;
  return wallet.label ? `${wallet.label} (${short})` : short;
}

export function WithdrawForm({ wallets }: { wallets: CustodyWalletSummary[] }) {
  const [walletId, setWalletId] = useState<string>(wallets[0]?.walletId ?? "");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [withdrawal, setWithdrawal] = useState<PrivateChannelWithdrawal | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  if (withdrawal) {
    return (
      <WithdrawProgress
        withdrawal={withdrawal}
        onReset={() => {
          setWithdrawal(null);
          setAmount("");
          setDestination("");
          setError(null);
        }}
      />
    );
  }

  if (wallets.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You have no custody wallets yet. Create one under Wallets, deposit into the channel, then
        come back to withdraw.
      </p>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createWithdrawalAction({
        walletId,
        amount: amount.trim(),
        destination: destination.trim() || undefined,
      });
      if (result.ok) {
        setWithdrawal(result.withdrawal);
        toast.success("Withdrawal submitted");
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
        <Label htmlFor="withdraw-wallet">Withdraw from</Label>
        <Select onValueChange={(value) => setWalletId(value ?? "")} value={walletId}>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.walletId} value={wallet.walletId}>
              {walletLabel(wallet)}
            </SelectItem>
          ))}
        </Select>
        <p className="text-muted-foreground text-xs">
          The burn is signed from this wallet. Its channel balance is debited.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="1.5"
          value={amount}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="withdraw-destination">Release to (optional)</Label>
        <Input
          id="withdraw-destination"
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Defaults to the withdrawing wallet"
          value={destination}
        />
        <p className="text-muted-foreground text-xs">
          A devnet address or walletId to receive the released USDC. Leave blank to release to this
          wallet.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button disabled={isSubmitting || !walletId || !amount.trim()} type="submit">
        {isSubmitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
        Withdraw
      </Button>
    </form>
  );
}
