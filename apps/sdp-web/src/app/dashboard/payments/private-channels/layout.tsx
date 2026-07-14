import type { ReactNode } from "react";
import { PrivateChannelsHeaderTabs } from "./private-channels-header-tabs";

export default function PrivateChannelsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PrivateChannelsHeaderTabs />
      {children}
    </>
  );
}
