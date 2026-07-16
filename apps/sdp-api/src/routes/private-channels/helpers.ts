import type { PrivateChannelEventType } from "@sdp/types";
import type { PrivateChannelInstanceRow } from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  type AppContext,
  getPrivateChannelEventService,
  getPrivateChannelInstanceRepository,
} from "./context";

/** Channels live under the project's active instance; resolve it or 503. */
export async function requireActiveInstance(c: AppContext): Promise<PrivateChannelInstanceRow> {
  const { organizationId } = getAuth(c);
  const projectId = requireProjectId(c);
  const instance = await getPrivateChannelInstanceRepository(c).getActiveByProject({
    organizationId,
    projectId,
  });
  if (!instance) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "No active Private Channels instance is connected for this project."
    );
  }
  return instance;
}

/** Lifecycle emit helper — same scope fields on every call-site. */
export function emitLifecycle(
  c: AppContext,
  instance: PrivateChannelInstanceRow,
  type: PrivateChannelEventType,
  extra?: { channelId?: string | null; payload?: Record<string, unknown> }
): Promise<void> {
  return getPrivateChannelEventService(c).emit({
    organizationId: instance.organization_id,
    projectId: instance.project_id,
    instanceId: instance.id,
    channelId: extra?.channelId ?? null,
    sdpUserId: getAuth(c).userId ?? null,
    family: "lifecycle",
    type,
    status: "info",
    payload: extra?.payload ?? {},
  });
}

/** Error emit helper (family=error, status=failed). */
export function recordInstanceError(
  c: AppContext,
  instance: PrivateChannelInstanceRow,
  type: PrivateChannelEventType,
  error: unknown,
  extra?: {
    channelId?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  return getPrivateChannelEventService(c).recordError({
    organizationId: instance.organization_id,
    projectId: instance.project_id,
    instanceId: instance.id,
    channelId: extra?.channelId ?? null,
    sdpUserId: getAuth(c).userId ?? null,
    type,
    payload: extra?.payload ?? {},
    error,
  });
}
