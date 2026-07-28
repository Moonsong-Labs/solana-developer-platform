import { auth } from "@clerk/nextjs/server";
import type {
  CustodyWalletSummary,
  PrivateChannelInstance,
  PrivateChannelInstanceOverview,
  PrivateChannelVerifiedWalletDto,
} from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { privateChannels } from "@/flags";
import { getAuthEntryPath } from "@/lib/auth-entry";
import {
  fetchCustodyWallets,
  fetchPrivateChannelBalance,
  fetchPrivateChannelOverview,
  fetchVerifiedWallets,
} from "@/lib/private-channels";
import { createSdpApiClient, type SdpApiClient } from "@/lib/sdp-api";
import { InstanceOverviewCard } from "./instance-overview-card";
import { VerifiedWalletsSection, type WalletChannelBalance } from "./verified-wallets-section";

async function loadOverview(): Promise<{
  instance: PrivateChannelInstance;
  overview: PrivateChannelInstanceOverview;
} | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelOverview(client);
  } catch {
    // 404 → no active instance; caller routes to /instance
    return null;
  }
}

async function loadWallets(): Promise<{
  verified: PrivateChannelVerifiedWalletDto[];
  custody: CustodyWalletSummary[];
  loadError: boolean;
}> {
  try {
    const client = await createSdpApiClient();
    const [verified, custody] = await Promise.all([
      fetchVerifiedWallets(client),
      fetchCustodyWallets(client),
    ]);
    return { verified, custody, loadError: false };
  } catch {
    // Surface the failure so the UI can show an error state rather than the
    // "create a wallet" empty CTA (which would mislead a user who has wallets).
    return { verified: [], custody: [], loadError: true };
  }
}

/**
 * Fetch each verified wallet's channel balance in parallel. Individual failures
 * are swallowed — a bad gateway read shouldn't gray out the whole card.
 */
async function loadChannelBalances(
  client: SdpApiClient,
  verified: PrivateChannelVerifiedWalletDto[]
): Promise<Record<string, WalletChannelBalance>> {
  const entries = await Promise.all(
    verified.map(async (w): Promise<[string, WalletChannelBalance] | null> => {
      try {
        const balance = await fetchPrivateChannelBalance(client, w.pubkey);
        return [w.pubkey, { uiAmount: balance.uiAmount, mint: balance.mint }];
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is [string, WalletChannelBalance] => e !== null));
}

export default async function PrivateChannelsOverviewPage() {
  if (!(await privateChannels())) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const [data, wallets] = await Promise.all([loadOverview(), loadWallets()]);
  if (!data) {
    redirect("/dashboard/payments/private-channels/instance");
  }

  // Channel balances only exist for verified wallets — unverified reads would 403.
  const channelBalances = wallets.loadError
    ? {}
    : await loadChannelBalances(await createSdpApiClient(), wallets.verified);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Live status of your connected instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <InstanceOverviewCard instance={data.instance} overview={data.overview} />
        </CardContent>
      </Card>

      <Card id="verified-wallets">
        <CardHeader>
          <CardTitle>Verified wallets</CardTitle>
          <CardDescription>
            Verify a custody wallet against this instance to unlock transactions. Verifying signs a
            challenge with the wallet; revoking removes it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerifiedWalletsSection
            verifiedWallets={wallets.verified}
            custodyWallets={wallets.custody}
            channelBalances={channelBalances}
            loadError={wallets.loadError}
          />
        </CardContent>
      </Card>
    </div>
  );
}
