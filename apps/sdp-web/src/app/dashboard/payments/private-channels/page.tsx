import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { PrivateChannelsConnectForm } from "./private-channels-connect-form";

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

  return (
    <div className="mx-auto w-full max-w-3xl">
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
