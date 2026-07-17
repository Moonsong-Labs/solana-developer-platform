import type { Context } from "hono";
import {
  createPrivateChannelInstanceRepository,
  createPrivateChannelRepository,
  createPrivateChannelUserRepository,
  createProjectUserRepository,
} from "@/db/repositories";
import type { Env } from "@/types/env";

/** Hono request context bound to the app `Env`. */
export type AppContext = Context<{ Bindings: Env }>;

export function getPrivateChannelInstanceRepository(c: AppContext) {
  return createPrivateChannelInstanceRepository(c.env);
}

export function getPrivateChannelRepository(c: AppContext) {
  return createPrivateChannelRepository(c.env);
}

export function getPrivateChannelUserRepository(c: AppContext) {
  return createPrivateChannelUserRepository(c.env);
}

export function getProjectUserRepository(c: AppContext) {
  return createProjectUserRepository(c.env);
}
