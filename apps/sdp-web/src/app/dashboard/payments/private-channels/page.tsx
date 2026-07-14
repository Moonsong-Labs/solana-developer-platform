import { redirect } from "next/navigation";

// The section root has no page of its own yet — Instance is the landing.
// Replace this with a real overview page if we ever want cards / section-level
// summaries above the tabs.
export default function PrivateChannelsPage() {
  redirect("/dashboard/payments/private-channels/instance");
}
