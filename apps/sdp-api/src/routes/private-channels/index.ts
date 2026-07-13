import { type Context, Hono, type Next } from "hono";
import { AppError } from "@/lib/errors";
import { isPrivateChannelsEnabled } from "@/lib/feature-flags";
import { requirePermissions, unifiedAuthMiddleware } from "@/middleware/auth";
import { projectContextMiddleware } from "@/middleware/project-context";
import type { Env } from "@/types/env";
import { getPrivateChannelHealth, getPrivateChannelInstance } from "./handlers";

const privateChannels = new Hono<{ Bindings: Env }>();

/**
 * Per-route gate: 503 PROVIDER_NOT_CONFIGURED unless the feature is enabled (a
 * gateway is configured). Attached to the instance-bound routes only, so the
 * candidate-gateway `/health` probe (a pre-connect test) stays reachable before
 * any instance is configured.
 */
async function requirePrivateChannelsFeature(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isPrivateChannelsEnabled(c.env)) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "Private channels are not configured for this environment."
    );
  }
  await next();
}

privateChannels.use("*", unifiedAuthMiddleware({ allowClerk: true, allowSession: true }));
privateChannels.use("*", projectContextMiddleware());

privateChannels.get("/health", requirePermissions("payments:read"), getPrivateChannelHealth);
privateChannels.get(
  "/instance",
  requirePrivateChannelsFeature,
  requirePermissions("payments:read"),
  getPrivateChannelInstance
);

export default privateChannels;
