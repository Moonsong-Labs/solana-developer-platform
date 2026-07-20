import type { PrivateChannelRow } from "@sdp/private-channels/channels";
import { validatePrivateChannelName } from "@sdp/private-channels/channels";
import { PRIVATE_CHANNEL_EVENT_TYPES, type PrivateChannelDto } from "@sdp/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { created, noContent, success } from "@/lib/response";
import { type AppContext, getPrivateChannelRepository } from "../context";
import { emitLifecycle, requireActiveInstance } from "../helpers";
import { createChannelBodySchema } from "../schemas";

function toPrivateChannelDto(row: PrivateChannelRow): PrivateChannelDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /channels — ensure the default channel exists, then list all (newest first). */
export async function listChannels(c: AppContext) {
  const instance = await requireActiveInstance(c);
  const scope = {
    instanceId: instance.id,
    organizationId: instance.organization_id,
    projectId: instance.project_id,
  };
  const repo = getPrivateChannelRepository(c);
  const { channel: defaultChannel, created } = await repo.getOrCreateDefault(scope);
  if (created) {
    await emitLifecycle(c, instance, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED, {
      channelId: defaultChannel.id,
      payload: { name: defaultChannel.name, isDefault: true },
    });
  }
  const channels = await repo.listChannels({ instanceId: instance.id });
  return success(c, { channels: channels.map(toPrivateChannelDto) });
}

/** POST /channels — create a named channel in the active instance. */
export async function createChannel(c: AppContext) {
  const instance = await requireActiveInstance(c);

  const body = await c.req.json().catch(() => null);
  const parsed = createChannelBodySchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid channel payload");
  }

  const name = parsed.data.name.trim();
  const nameError = validatePrivateChannelName(name);
  if (nameError) {
    throw badRequest(nameError);
  }

  const channel = await getPrivateChannelRepository(c).createChannel({
    instanceId: instance.id,
    organizationId: instance.organization_id,
    projectId: instance.project_id,
    name,
    description: parsed.data.description?.trim() || null,
  });
  if (!channel) {
    throw conflict("A channel with this name already exists in the instance");
  }

  await emitLifecycle(c, instance, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED, {
    channelId: channel.id,
    payload: { name: channel.name },
  });

  return created(c, toPrivateChannelDto(channel));
}

/** GET /channels/:id — fetch a single channel in the active instance. */
export async function getChannel(c: AppContext) {
  const instance = await requireActiveInstance(c);
  const channelId = c.req.param("id");
  if (!channelId) {
    throw badRequest("Channel id is required");
  }
  const channel = await getPrivateChannelRepository(c).getChannel({
    channelId,
    instanceId: instance.id,
  });
  if (!channel) {
    throw notFound("Channel");
  }
  return success(c, toPrivateChannelDto(channel));
}

/** DELETE /channels/:id — archive a channel (soft delete). The default is protected. */
export async function deleteChannel(c: AppContext) {
  const instance = await requireActiveInstance(c);
  const channelId = c.req.param("id");
  if (!channelId) {
    throw badRequest("Channel id is required");
  }

  const repo = getPrivateChannelRepository(c);
  const channel = await repo.getChannel({ channelId, instanceId: instance.id });
  if (!channel) {
    throw notFound("Channel");
  }
  if (channel.is_default) {
    throw conflict("The default channel cannot be deleted");
  }

  await repo.archiveChannel({ channelId, instanceId: instance.id });
  await emitLifecycle(c, instance, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_ARCHIVED, {
    channelId: channel.id,
    payload: { name: channel.name },
  });
  return noContent(c);
}
