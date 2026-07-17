import { auth } from "@clerk/nextjs/server";
import type { PrivateChannelInstance, PrivateChannelInstanceOverview } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannelOverview } from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { InstanceOverviewCard } from "./instance-overview-card";

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

export default async function PrivateChannelsOverviewPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const data = await loadOverview();
  if (!data) {
    redirect("/dashboard/payments/private-channels/instance");
  }

  // TODO (frontend): Add a "Verified wallets" section to this dashboard page.
  //  - Add + verify flow: let the user pick from their existing SDP wallets
  //    (reuse getCustodyWallets — GET /v1/wallets?includeAllProviders=true, see
  //    dashboard/custody/page.tsx; render with WalletCard / WalletProviderMark /
  //    formatCustodyProviderName; self-custody = provider "local", Privy = "privy"),
  //    then run challenge → sign with the selected wallet → verify against the
  //    connected instance (future POST verify API).
  //  - Delete flow: paired delete UX (mirror channels/channels-manager.tsx per-row
  //    delete + the DeleteConfirmationDialog in
  //    instance/private-channels-connect-form.tsx), calling the future DELETE wallet API.
  //  - List: add a fetchVerifiedWallets fetcher in lib/private-channels.ts
  //    (GET /v1/private-channels/wallets is already live) and render the current
  //    verified wallets here.
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Live status of your connected instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <InstanceOverviewCard instance={data.instance} overview={data.overview} />
        </CardContent>
      </Card>
    </div>
  );
}
