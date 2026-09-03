import { proxyToSdpApi } from "@/lib/sdp-api";

export async function POST(request: Request) {
  return proxyToSdpApi({
    request,
    traceSource: "route.dashboard.helius-rings.connections.import-legacy",
    path: "/internal/dashboard/helius-rings/connections/import-legacy",
  });
}
