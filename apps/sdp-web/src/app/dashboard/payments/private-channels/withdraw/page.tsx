import { auth } from "@clerk/nextjs/server";
import type { CustodyWalletSummary } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { privateChannels } from "@/flags";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannelInstance, fetchVerifiedSignableWallets } from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";
import { WithdrawForm } from "./withdraw-form";

async function loadWallets(): Promise<CustodyWalletSummary[]> {
  const client = await createSdpApiClient();
  const { instance } = await fetchPrivateChannelInstance(client);
  if (!instance?.isActive) {
    redirect("/dashboard/payments/private-channels/instance");
  }
  return fetchVerifiedSignableWallets(client);
}

export default async function PrivateChannelsWithdrawPage() {
  if (!(await privateChannels())) {
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
          <CardTitle>Withdraw</CardTitle>
          <CardDescription>
            Burn a custody wallet's channel balance and have the operator release the matching USDC
            on devnet. Watch it progress from the burn to the devnet release.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WithdrawForm wallets={wallets} />
        </CardContent>
      </Card>
    </div>
  );
}
