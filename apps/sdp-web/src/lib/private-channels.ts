import type {
  CreatePrivateChannelRequest,
  CustodyWalletSummary,
  PrivateChannelDeposit,
  PrivateChannelDto,
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

/** List channels for the active instance (newest first); ensures the default channel exists. */
export async function fetchPrivateChannels(client: SdpApiClient): Promise<PrivateChannelDto[]> {
  const { channels } = await client.fetch<{ channels: PrivateChannelDto[] }>(
    "/v1/private-channels/channels"
  );
  return channels;
}

/** Create a named channel in the current project. */
export function createPrivateChannel(
  client: SdpApiClient,
  body: CreatePrivateChannelRequest
): Promise<PrivateChannelDto> {
  return client.fetch<PrivateChannelDto>("/v1/private-channels/channels", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Delete (archive) a channel by id. The default channel cannot be deleted. */
export function deletePrivateChannel(client: SdpApiClient, id: string): Promise<unknown> {
  return client.fetch(`/v1/private-channels/channels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** List the project's custody wallets (the deposit source picker). */
export async function fetchCustodyWallets(client: SdpApiClient): Promise<CustodyWalletSummary[]> {
  const { wallets } = await client.fetch<{ wallets: CustodyWalletSummary[] }>("/v1/wallets");
  return wallets;
}

/** List the project's deposits, newest first. */
export async function fetchPrivateChannelDeposits(
  client: SdpApiClient
): Promise<PrivateChannelDeposit[]> {
  const { deposits } = await client.fetch<{ deposits: PrivateChannelDeposit[] }>(
    "/v1/private-channels/deposits"
  );
  return deposits;
}

/** Read one deposit (poll for status transitions). */
export function fetchPrivateChannelDeposit(
  client: SdpApiClient,
  id: string
): Promise<PrivateChannelDeposit> {
  return client.fetch<PrivateChannelDeposit>(
    `/v1/private-channels/deposits/${encodeURIComponent(id)}`
  );
}

/** Create a deposit from a custody wallet into the channel escrow. */
export function createPrivateChannelDeposit(
  client: SdpApiClient,
  body: { walletId: string; amount: string; recipient?: string }
): Promise<PrivateChannelDeposit> {
  return client.fetch<PrivateChannelDeposit>("/v1/private-channels/deposits", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
