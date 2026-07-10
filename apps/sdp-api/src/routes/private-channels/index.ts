import { type Context, Hono, type Next } from "hono";
import { AppError } from "@/lib/errors";
import { requirePermissions, unifiedAuthMiddleware } from "@/middleware/auth";
import { projectContextMiddleware } from "@/middleware/project-context";
import { isSpcConfigured } from "@/services/private-channels";
import type { Env } from "@/types/env";
import {
  createPrivateChannelTransfer,
  getPrivateChannelBalances,
  getPrivateChannelInstance,
} from "./handlers";

const privateChannels = new Hono<{ Bindings: Env }>();

/** Gate the router: 503 PROVIDER_NOT_CONFIGURED unless an SPC gateway is set. */
async function requireSpcConfigured(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isSpcConfigured(c.env)) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "Private channels are not configured for this environment."
    );
  }
  await next();
}

privateChannels.use("*", unifiedAuthMiddleware({ allowClerk: true, allowSession: true }));
privateChannels.use("*", projectContextMiddleware());
privateChannels.use("*", requireSpcConfigured);

privateChannels.get("/instance", requirePermissions("payments:read"), getPrivateChannelInstance);
privateChannels.get(
  "/balances",
  requirePermissions("payments:read", "wallets:read"),
  getPrivateChannelBalances
);
privateChannels.post(
  "/transfers",
  requirePermissions("payments:write", "wallets:read"),
  createPrivateChannelTransfer
);

export default privateChannels;
