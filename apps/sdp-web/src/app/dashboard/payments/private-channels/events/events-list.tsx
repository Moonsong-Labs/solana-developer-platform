"use client";

import {
  PRIVATE_CHANNEL_EVENT_FAMILIES,
  PRIVATE_CHANNEL_EVENT_STATUSES,
  type PrivateChannelEventDto,
  type PrivateChannelEventFamily,
} from "@sdp/types";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadProjectEventsAction } from "./actions";

interface Props {
  initialEvents: PrivateChannelEventDto[];
  initialHasMore: boolean;
  initialNextCursor: string | null;
}

const FAMILY_BADGE: Record<PrivateChannelEventFamily, BadgeVariant> = {
  [PRIVATE_CHANNEL_EVENT_FAMILIES.LIFECYCLE]: "info",
  [PRIVATE_CHANNEL_EVENT_FAMILIES.ERROR]: "danger",
  [PRIVATE_CHANNEL_EVENT_FAMILIES.MEMBER]: "default",
  [PRIVATE_CHANNEL_EVENT_FAMILIES.TRANSFER]: "success",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function payloadPreview(payload: Record<string, unknown>): string | null {
  const keys = Object.keys(payload);
  if (keys.length === 0) return null;
  try {
    const text = JSON.stringify(payload);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  } catch {
    return null;
  }
}

export function EventsList({ initialEvents, initialHasMore, initialNextCursor }: Props) {
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, startLoadMore] = useTransition();

  function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    startLoadMore(async () => {
      const result = await loadProjectEventsAction({ before: nextCursor, limit: 50 });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setEvents((prev) => [...prev, ...result.data.events]);
      setHasMore(result.data.hasMore);
      setNextCursor(result.data.nextCursor);
    });
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-text-medium">
        No events yet. Connect an instance or create a channel to start the activity feed.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {events.map((event) => {
          const preview = payloadPreview(event.payload);
          return (
            <li key={event.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={FAMILY_BADGE[event.family] ?? "default"}>{event.family}</Badge>
                <span className="font-medium text-text-extra-high">{event.type}</span>
                <Badge
                  variant={
                    event.status === PRIVATE_CHANNEL_EVENT_STATUSES.FAILED ? "danger" : "default"
                  }
                >
                  {event.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-medium">
                <span>{formatWhen(event.occurredAt)}</span>
                {event.channelId ? <span>channel {event.channelId.slice(0, 12)}…</span> : null}
              </div>
              {preview ? (
                <pre className="overflow-x-auto rounded bg-[rgba(28,28,29,0.04)] px-2 py-1 text-xs text-text-medium">
                  {preview}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>

      {hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? <Loader2Icon className="animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
