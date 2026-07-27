"use client";

import type { CustodyWalletSummary, PrivateChannelVerifiedWalletDto } from "@sdp/types";
import { CheckCircle2Icon, Loader2Icon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  formatCustodyProviderName,
  isKnownCustodyProvider,
} from "@/app/dashboard/custody/provider-catalog";
import { WalletProviderMark } from "@/app/dashboard/custody/wallet-provider-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteVerifiedWalletAction, verifyWalletAction } from "./actions";

/** Channel balance projected for a single verified wallet (per mint). */
export interface WalletChannelBalance {
  uiAmount: string;
  mint: string;
}

interface Props {
  verifiedWallets: PrivateChannelVerifiedWalletDto[];
  custodyWallets: CustodyWalletSummary[];
  /** Keyed by wallet pubkey; entry present when the balance read succeeded. */
  channelBalances: Record<string, WalletChannelBalance>;
  loadError: boolean;
}

function shortKey(pk: string): string {
  return pk.length > 12 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;
}

export function VerifiedWalletsSection({
  verifiedWallets,
  custodyWallets,
  channelBalances,
  loadError,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const verifiedByPubkey = new Map(verifiedWallets.map((w) => [w.pubkey, w]));
  const custodyPubkeys = new Set(custodyWallets.map((w) => w.publicKey));
  // Keep delete reachable for verifications whose custody wallet is no longer listed.
  const orphanedVerified = verifiedWallets.filter((w) => !custodyPubkeys.has(w.pubkey));

  function handleVerify(walletId: string, pubkey: string) {
    setPendingKey(walletId);
    startTransition(async () => {
      const result = await verifyWalletAction(walletId);
      if (result.ok) {
        toast.success(`Wallet ${shortKey(pubkey)} verified.`);
      } else {
        toast.error(result.message);
      }
      setPendingKey(null);
    });
  }

  function handleDelete(pubkey: string) {
    setPendingKey(pubkey);
    startTransition(async () => {
      const result = await deleteVerifiedWalletAction(pubkey);
      if (result.ok) {
        toast.success(`Verification for ${shortKey(pubkey)} revoked.`);
      } else {
        toast.error(result.message);
      }
      setPendingKey(null);
    });
  }

  if (loadError) {
    return (
      <p className="text-sm text-status-error-text">
        Couldn't load your wallets. Refresh the page to try again.
      </p>
    );
  }

  if (custodyWallets.length === 0 && orphanedVerified.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-text-medium">No wallets found for user, create one.</p>
        <Button asChild>
          <Link href="/dashboard/wallets">Create a wallet</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {custodyWallets.map((wallet) => {
        const verified = verifiedByPubkey.get(wallet.publicKey);
        return (
          <li key={wallet.walletId} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {wallet.provider && isKnownCustodyProvider(wallet.provider) ? (
                <WalletProviderMark provider={wallet.provider} size="sm" />
              ) : null}
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {wallet.label ?? formatCustodyProviderName(wallet.provider ?? "wallet")}
                </span>
                <span className="truncate font-mono text-xs text-text-medium">
                  {wallet.publicKey}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {verified ? (
                <>
                  {channelBalances[wallet.publicKey] ? (
                    <span
                      className="font-mono text-sm text-text-medium"
                      title={`Channel balance for mint ${channelBalances[wallet.publicKey].mint}`}
                    >
                      {channelBalances[wallet.publicKey].uiAmount} USDC
                    </span>
                  ) : null}
                  <Badge variant="success">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2Icon className="size-3" />
                      Verified
                    </span>
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke verification for ${wallet.publicKey}`}
                    title="Revoke verification"
                    disabled={pending && pendingKey === wallet.publicKey}
                    onClick={() => handleDelete(wallet.publicKey)}
                  >
                    {pending && pendingKey === wallet.publicKey ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <Trash2Icon />
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  disabled={pending && pendingKey === wallet.walletId}
                  onClick={() => handleVerify(wallet.walletId, wallet.publicKey)}
                >
                  {pending && pendingKey === wallet.walletId ? (
                    <Loader2Icon className="animate-spin" />
                  ) : null}
                  Verify
                </Button>
              )}
            </div>
          </li>
        );
      })}

      {orphanedVerified.map((w) => (
        <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-sm">{w.pubkey}</span>
            <span className="text-xs text-text-medium">Custody wallet no longer listed</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {channelBalances[w.pubkey] ? (
              <span
                className="font-mono text-sm text-text-medium"
                title={`Channel balance for mint ${channelBalances[w.pubkey].mint}`}
              >
                {channelBalances[w.pubkey].uiAmount} USDC
              </span>
            ) : null}
            <Badge variant="success">Verified</Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Revoke verification for ${w.pubkey}`}
              title="Revoke verification"
              disabled={pending && pendingKey === w.pubkey}
              onClick={() => handleDelete(w.pubkey)}
            >
              {pending && pendingKey === w.pubkey ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
