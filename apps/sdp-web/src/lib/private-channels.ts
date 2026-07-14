import type {
  PrivateChannelHealth,
  PrivateChannelInstance,
  PrivateChannelInstanceEnvelope,
  PrivateChannelInstanceOverview,
} from "@sdp/types";
import type { SdpApiClient } from "@/lib/sdp-api";

/**
 * Probe a candidate SPC gateway's health via `GET /v1/private-channels/health`.
 * Always resolves with a `PrivateChannelHealth` DTO (ready/degraded/unreachable);
 * only a missing gateway URL surfaces as a rejection.
 */
export function probePrivateChannelHealth(
  client: SdpApiClient,
  gatewayUrl: string
): Promise<PrivateChannelHealth> {
  return client.fetch<PrivateChannelHealth>(
    `/v1/private-channels/health?gatewayUrl=${encodeURIComponent(gatewayUrl)}`
  );
}

/** Fetch this project's connected SPC instance (or `{ instance: null }`). */
export function fetchPrivateChannelInstance(
  client: SdpApiClient
): Promise<PrivateChannelInstanceEnvelope> {
  return client.fetch<PrivateChannelInstanceEnvelope>("/v1/private-channels/instance");
}

/** Fetch the active instance + its post-connect overview. 404 when none active. */
export function fetchPrivateChannelOverview(client: SdpApiClient): Promise<{
  instance: PrivateChannelInstance;
  overview: PrivateChannelInstanceOverview;
}> {
  return client.fetch("/v1/private-channels/instance/overview");
}
