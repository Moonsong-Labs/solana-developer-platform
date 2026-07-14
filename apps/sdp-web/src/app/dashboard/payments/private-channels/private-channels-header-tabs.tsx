"use client";

import { Tab, TabList, Tabs } from "@solana/design-system/tabs";
import { usePathname, useRouter } from "next/navigation";

// Adding a new Private Channels sub-page (e.g. transfers, channels, members):
//   1. Create app/dashboard/payments/private-channels/<slug>/page.tsx
//   2. Append { id, label, href } here.
// The tab bar auto-surfaces once TABS has ≥ 2 entries; nothing else to wire.
const TABS = [
  {
    id: "instance",
    label: "Instance",
    href: "/dashboard/payments/private-channels/instance",
  },
] as const;

export function PrivateChannelsHeaderTabs() {
  const router = useRouter();
  const pathname = usePathname();

  if (TABS.length < 2) return null;

  const activeId = TABS.find((t) => pathname.startsWith(t.href))?.id ?? TABS[0].id;

  return (
    <div className="mb-6">
      <Tabs
        bordered
        value={activeId}
        onValueChange={(value) => {
          const next = TABS.find((t) => t.id === value);
          if (next) router.push(next.href);
        }}
      >
        <TabList>
          {TABS.map((tab) => (
            <Tab key={tab.id} value={tab.id}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
    </div>
  );
}
