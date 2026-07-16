import type {
  CreatePrivateChannelRequest,
  InvitePrivateChannelUserRequest,
  PrivateChannelDto,
  PrivateChannelHealth,
  PrivateChannelInstance,
  PrivateChannelInstanceEnvelope,
  PrivateChannelInstanceOverview,
  PrivateChannelUserDto,
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

/** List workspace users (invited SDP users), each joined with channel memberships. */
export async function fetchPrivateChannelUsers(
  client: SdpApiClient
): Promise<PrivateChannelUserDto[]> {
  const { users } = await client.fetch<{ users: PrivateChannelUserDto[] }>(
    "/v1/private-channels/users"
  );
  return users;
}

/** Caller's own workspace membership for the active project, or null. */
export async function fetchMyPrivateChannelUser(
  client: SdpApiClient
): Promise<PrivateChannelUserDto | null> {
  const { user } = await client.fetch<{ user: PrivateChannelUserDto | null }>(
    "/v1/private-channels/users/me"
  );
  return user;
}

/**
 * Invite an SDP project user to the SPC workspace. Returns the created user
 * DTO plus the invite URL (email is scaffolded — the admin can copy it).
 */
export function invitePrivateChannelUser(
  client: SdpApiClient,
  body: InvitePrivateChannelUserRequest
): Promise<{ user: PrivateChannelUserDto; inviteUrl: string }> {
  return client.fetch<{ user: PrivateChannelUserDto; inviteUrl: string }>(
    "/v1/private-channels/users",
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** Hard-delete a workspace user (revoke). Cascades to channel memberships. */
export function deletePrivateChannelUser(
  client: SdpApiClient,
  privateChannelUserId: string
): Promise<unknown> {
  return client.fetch(
    `/v1/private-channels/users/${encodeURIComponent(privateChannelUserId)}`,
    { method: "DELETE" }
  );
}

/** Add a workspace user to a channel (idempotent). */
export function addChannelMembership(
  client: SdpApiClient,
  channelId: string,
  privateChannelUserId: string
): Promise<unknown> {
  return client.fetch(
    `/v1/private-channels/channels/${encodeURIComponent(channelId)}/memberships`,
    { method: "POST", body: JSON.stringify({ privateChannelUserId }) }
  );
}

/** Remove a workspace user from a channel. */
export function removeChannelMembership(
  client: SdpApiClient,
  channelId: string,
  privateChannelUserId: string
): Promise<unknown> {
  return client.fetch(
    `/v1/private-channels/channels/${encodeURIComponent(channelId)}/memberships/${encodeURIComponent(privateChannelUserId)}`,
    { method: "DELETE" }
  );
}
