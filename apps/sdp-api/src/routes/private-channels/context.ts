import type { Context } from "hono";
import { createPrivateChannelInstanceRepository } from "@/db/repositories";
import type { Env } from "@/types/env";

export type AppContext = Context<{ Bindings: Env }>;

export function getPrivateChannelInstanceRepository(c: AppContext) {
  return createPrivateChannelInstanceRepository(c.env);
}
