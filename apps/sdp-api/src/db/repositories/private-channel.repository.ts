import type { PrivateChannelRow } from "@sdp/private-channels/channels";
import type { RepositoryDbClient } from "./base";

export type { PrivateChannelRow };

export function generatePrivateChannelId(): string {
  return `pch_${crypto.randomUUID()}`;
}

/** Instance the channel belongs to, plus the denormalized tenancy columns. */
export interface PrivateChannelScope {
  instanceId: string;
  organizationId: string;
  projectId: string;
}

export interface CreatePrivateChannelInput extends PrivateChannelScope {
  name: string;
  description: string | null;
}

export interface PrivateChannelRef {
  instanceId: string;
  channelId: string;
}

export interface PrivateChannelRepositoryContext {
  db: RepositoryDbClient;
}

export interface PrivateChannelRepository {
  /**
   * Idempotently ensure the instance's `default` channel exists and return it.
   * Race-safe (the one-default-per-instance partial unique index collapses
   * concurrent creates); falls back to a suffixed name if a non-default channel
   * already holds the canonical "Default" name.
   */
  getOrCreateDefault(params: PrivateChannelScope): Promise<PrivateChannelRow>;
  /** Create a named (non-default) channel. Returns null on duplicate name. */
  createChannel(input: CreatePrivateChannelInput): Promise<PrivateChannelRow | null>;
  /** List the instance's active channels, newest first. */
  listChannels(params: { instanceId: string }): Promise<PrivateChannelRow[]>;
  /** Fetch a single active channel within the instance. */
  getChannel(params: PrivateChannelRef): Promise<PrivateChannelRow | null>;
  /**
   * Soft-delete (archive) a channel. Returns false when not found or already
   * archived. Callers must guard the default channel.
   */
  archiveChannel(params: PrivateChannelRef): Promise<boolean>;
}
