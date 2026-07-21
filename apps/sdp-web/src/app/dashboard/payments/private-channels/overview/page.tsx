import { auth } from "@clerk/nextjs/server";
import type {
  CustodyWalletSummary,
  PrivateChannelInstance,
  PrivateChannelInstanceOverview,
  PrivateChannelVerifiedWalletDto,
} from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import {
  fetchCustodyWallets,
  fetchPrivateChannelOverview,
  fetchVerifiedWallets,
} from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { InstanceOverviewCard } from "./instance-overview-card";
import { VerifiedWalletsSection } from "./verified-wallets-section";

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

export default async function PrivateChannelsOverviewPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const [data, wallets] = await Promise.all([loadOverview(), loadWallets()]);
  if (!data) {
    redirect("/dashboard/payments/private-channels/instance");
  }

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
            loadError={wallets.loadError}
          />
        </CardContent>
      </Card>
    </div>
  );
}
