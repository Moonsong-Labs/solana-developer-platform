import type { Context } from "hono";
import {
  createPrivateChannelEventRepository,
  createPrivateChannelInstanceRepository,
  createPrivateChannelRepository,
} from "@/db/repositories";
import { createPrivateChannelEventService } from "@/services/private-channels/event.service";
import type { Env } from "@/types/env";

/** Hono request context bound to the app `Env`. */
export type AppContext = Context<{ Bindings: Env }>;

export function getPrivateChannelInstanceRepository(c: AppContext) {
  return createPrivateChannelInstanceRepository(c.env);
}

export function getPrivateChannelRepository(c: AppContext) {
  return createPrivateChannelRepository(c.env);
}

export function getPrivateChannelEventRepository(c: AppContext) {
  return createPrivateChannelEventRepository(c.env);
}

export function getPrivateChannelEventService(c: AppContext) {
  return createPrivateChannelEventService(c.env);
}
