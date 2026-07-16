import { auth } from "@clerk/nextjs/server";
import type { CustodyWalletSummary } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchCustodyWallets, fetchPrivateChannelInstance } from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { DepositForm } from "./deposit-form";

async function loadWallets(): Promise<CustodyWalletSummary[]> {
  const client = await createSdpApiClient();
  const { instance } = await fetchPrivateChannelInstance(client);
  if (!instance?.isActive) {
    redirect("/dashboard/payments/private-channels/instance");
  }
  return fetchCustodyWallets(client);
}

export default async function PrivateChannelsDepositPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) {
    redirect(await getAuthEntryPath());
  }
  if (!orgId) {
    redirect("/dashboard");
  }

  const wallets = await loadWallets();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Deposit</CardTitle>
          <CardDescription>
            Move USDC from a custody wallet into the channel escrow on devnet. Watch it progress
            from the escrow contract to your credited channel balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DepositForm wallets={wallets} />
        </CardContent>
      </Card>
    </div>
  );
}
