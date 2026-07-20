import { auth } from "@clerk/nextjs/server";
import type { PrivateChannelEventListEnvelope } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannelEvents } from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { EventsList } from "./events-list";

async function loadEvents(): Promise<PrivateChannelEventListEnvelope> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelEvents(client, { limit: 50 });
  } catch {
    return { events: [], hasMore: false, nextCursor: null };
  }
}

export default async function PrivateChannelsEventsPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const { events, hasMore, nextCursor } = await loadEvents();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Project activity for Private Channels (lifecycle, errors, and future member/transfer
            events). History is kept even after an instance is disconnected or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventsList
            initialEvents={events}
            initialHasMore={hasMore}
            initialNextCursor={nextCursor}
          />
        </CardContent>
      </Card>
    </div>
  );
}
