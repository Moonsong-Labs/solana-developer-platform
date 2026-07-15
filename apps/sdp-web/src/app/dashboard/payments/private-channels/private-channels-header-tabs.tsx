"use client";

import { Tab, TabList, Tabs } from "@solana/design-system/tabs";
import { usePathname, useRouter } from "next/navigation";

// Adding a new sub-page (transfers, channels, members, …):
//   1. Create app/dashboard/payments/private-channels/<slug>/page.tsx
//   2. Append { id, label, href, requiresActive: true } ABOVE the Instance entry
//      (Instance always stays last so the connect/disconnect surface is at the
//      end of the tab bar even as new features land).
const TABS = [
  {
    id: "overview",
    label: "Overview",
    href: "/dashboard/payments/private-channels/overview",
    requiresActive: true,
  },
  {
    id: "channels",
    label: "Channels",
    href: "/dashboard/payments/private-channels/channels",
    requiresActive: true,
  },
  {
    id: "instance",
    label: "Instance",
    href: "/dashboard/payments/private-channels/instance",
    requiresActive: false,
  },
] as const;

interface Props {
  isConnected: boolean;
}

export function PrivateChannelsHeaderTabs({ isConnected }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const visible = TABS.filter((t) => isConnected || !t.requiresActive);
  if (visible.length < 2) return null;

  const activeId = visible.find((t) => pathname.startsWith(t.href))?.id ?? visible[0].id;

  return (
    <div className="mb-6">
      <Tabs
        bordered
        value={activeId}
        onValueChange={(value) => {
          const next = visible.find((t) => t.id === value);
          if (next) router.push(next.href);
        }}
      >
        <TabList>
          {visible.map((tab) => (
            <Tab key={tab.id} value={tab.id}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
    </div>
  );
}
