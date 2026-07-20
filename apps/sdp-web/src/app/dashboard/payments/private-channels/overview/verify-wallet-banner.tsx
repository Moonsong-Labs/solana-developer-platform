"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Scaffold: renders above the overview when the current viewer is an invited
// SPC user with wallet_verified=false. The click handler is a placeholder
// until the challenge/verify wallet flow lands.
export function VerifyWalletBanner() {
  const onClick = () => {
    toast.info(
      "Wallet verification flow coming soon. You'll be asked to sign a message from a Solana wallet."
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-status-warning-text">Verify your wallet</p>
        <p className="text-xs text-text-medium">
          Your account is connected but not yet verified. Verify a Solana wallet to unlock
          transactions on this instance.
        </p>
      </div>
      <Button type="button" onClick={onClick}>
        Verify wallet
      </Button>
    </div>
  );
}
