import { type Context, Hono, type Next } from "hono";
import { AppError } from "@/lib/errors";
import { isPrivateChannelsEnabled } from "@/lib/feature-flags";
import { requirePermissions, unifiedAuthMiddleware } from "@/middleware/auth";
import { projectContextMiddleware } from "@/middleware/project-context";
import type { Env } from "@/types/env";
import {
  connectPrivateChannelInstance,
  deletePrivateChannelInstance,
  disconnectPrivateChannelInstance,
  getPrivateChannelHealth,
  getPrivateChannelInstance,
} from "./handlers";

const privateChannels = new Hono<{ Bindings: Env }>();

/**
 * Router-wide gate: 503 PROVIDER_NOT_CONFIGURED unless the feature is enabled.
 * Applied once as middleware so every current and future route inherits it.
 */
async function requirePrivateChannelsFeature(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isPrivateChannelsEnabled(c.env)) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "Private Channels are not enabled for this environment."
    );
  }
  await next();
}

privateChannels.use("*", requirePrivateChannelsFeature);
privateChannels.use("*", unifiedAuthMiddleware({ allowClerk: true, allowSession: true }));
privateChannels.use("*", projectContextMiddleware());

// --- /health --------------------------------------------------------------
// Pre-connect test of a caller-supplied gateway URL. Always 200 with a
// PrivateChannelHealth DTO (ready/degraded/unreachable); only a missing URL is 400.
privateChannels.get("/health", requirePermissions("payments:read"), getPrivateChannelHealth);

// --- /instance ------------------------------------------------------------
const instance = new Hono<{ Bindings: Env }>();
instance.get("/", requirePermissions("payments:read"), getPrivateChannelInstance);
instance.post("/", requirePermissions("payments:write"), connectPrivateChannelInstance);
instance.delete("/", requirePermissions("payments:write"), deletePrivateChannelInstance);
instance.post(
  "/disconnect",
  requirePermissions("payments:write"),
  disconnectPrivateChannelInstance
);
privateChannels.route("/instance", instance);

export default privateChannels;
