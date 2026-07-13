import { auth } from "@clerk/nextjs/server";
import type { PrivateChannelInstanceInfo } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannelInstance } from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { PrivateChannelsConnectForm } from "./private-channels-connect-form";

/**
 * Load the connected instance, or `null` when none is configured (the endpoint
 * returns 503) or the request otherwise fails — in which case the page shows
 * only the connect form.
 */
async function loadInstance(): Promise<PrivateChannelInstanceInfo | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelInstance(client);
  } catch {
    return null;
  }
}

function InstanceSummary({ instance }: { instance: PrivateChannelInstanceInfo }) {
  const rows: Array<[string, string]> = [
    ["Gateway URL", instance.gatewayUrl],
    ["Auth mode", instance.authMode],
    ["Network", instance.network],
    ["Health", instance.healthy ? "Healthy" : "Unhealthy"],
    ["Ready", instance.ready ? "Ready" : "Not ready"],
  ];
  if (instance.escrowProgramId) rows.push(["Escrow program", instance.escrowProgramId]);
  if (instance.withdrawProgramId) rows.push(["Withdraw program", instance.withdrawProgramId]);
  if (instance.escrowInstance) rows.push(["Escrow instance", instance.escrowInstance]);
  if (instance.usdcMint) rows.push(["USDC mint", instance.usdcMint]);

  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all text-right font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function PrivateChannelsPage() {
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

  const instance = await loadInstance();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {instance && (
        <Card>
          <CardHeader>
            <CardTitle>Connected instance</CardTitle>
            <CardDescription>
              The Solana Private Channels instance SDP is currently pointed at.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InstanceSummary instance={instance} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connect Private Channel</CardTitle>
          <CardDescription>
            Point SDP at a Solana Private Channels instance. Test the gateway before saving —
            persistence lands in the next slice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PrivateChannelsConnectForm />
        </CardContent>
      </Card>
    </div>
  );
}
