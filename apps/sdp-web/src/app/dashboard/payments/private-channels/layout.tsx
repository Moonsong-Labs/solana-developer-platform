import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { privateChannels } from "@/flags";
import { createSdpApiClient } from "@/lib/sdp-api";
import { PrivateChannelsHeaderTabs } from "./private-channels-header-tabs";
import { loadInstance } from "./private-channels-page.data";

export default async function PrivateChannelsLayout({ children }: { children: ReactNode }) {
  // Gate before the instance lookup: every leaf page checks the flag too, so without
  // this a hand-typed URL spends an authenticated API round trip only to 404, and the
  // header tabs render around the child's notFound().
  if (!(await privateChannels())) {
    notFound();
  }

  const client = await createSdpApiClient();
  const instance = await loadInstance(client);

  // The shell locks the viewport for every /dashboard/payments route
  // (`shouldUseWorkspaceViewport` in dashboard-shell.tsx) and renders children
  // inside `overflow-hidden`, so each route owns its own scrolling — same shape
  // the sibling payments workspaces use. Scrolling lives here rather than in the
  // seven leaf pages, and the tabs stay pinned above the scroll area.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PrivateChannelsHeaderTabs isConnected={instance.data?.isActive === true} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
