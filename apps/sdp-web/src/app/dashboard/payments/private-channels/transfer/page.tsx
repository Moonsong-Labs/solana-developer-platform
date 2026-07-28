import { auth } from "@clerk/nextjs/server";
import type { CustodyWalletSummary, PrivateChannelMembershipChannelDto } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { privateChannels } from "@/flags";
import { getAuthEntryPath } from "@/lib/auth-entry";
import {
  fetchAuthenticatedPrivateChannelUser,
  fetchPrivateChannelInstance,
  fetchPrivateChannels,
  fetchSignableCustodyWallets,
  fetchVerifiedWallets,
} from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";
import { TransferForm } from "./transfer-form";
import {
  createTransferScopeKey,
  intersectEligibleTransferChannels,
  intersectVerifiedSourceWallets,
} from "./transfer-page-data";

async function loadTransferData(organizationId: string): Promise<{
  channels: PrivateChannelMembershipChannelDto[];
  scopeKey: string;
  sourceWallets: CustodyWalletSummary[];
}> {
  const client = await createSdpApiClient();
  const { instance } = await fetchPrivateChannelInstance(client);
  if (!instance?.isActive) {
    redirect("/dashboard/payments/private-channels/instance");
  }

  const [member, activeChannels, signableWallets, verifiedWallets] = await Promise.all([
    fetchAuthenticatedPrivateChannelUser(client),
    fetchPrivateChannels(client),
    fetchSignableCustodyWallets(client),
    fetchVerifiedWallets(client),
  ]);

  return {
    channels: intersectEligibleTransferChannels(member?.channels ?? [], activeChannels),
    scopeKey: createTransferScopeKey(organizationId, instance.projectId, instance.id),
    sourceWallets: intersectVerifiedSourceWallets(signableWallets, verifiedWallets),
  };
}

export default async function PrivateChannelsTransferPage() {
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

  const { channels, scopeKey, sourceWallets } = await loadTransferData(orgId);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Transfer</CardTitle>
          <CardDescription>
            Transfer USDC from your selected verified custody wallet to another verified member
            wallet in the same logical channel. Wallet balances are shared across logical channels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransferForm channels={channels} scopeKey={scopeKey} sourceWallets={sourceWallets} />
        </CardContent>
      </Card>
    </div>
  );
}
