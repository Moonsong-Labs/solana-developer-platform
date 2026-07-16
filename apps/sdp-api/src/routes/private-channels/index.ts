import { type Context, Hono, type Next } from "hono";
import { AppError } from "@/lib/errors";
import { isPrivateChannelsEnabled } from "@/lib/feature-flags";
import { requirePermissions, unifiedAuthMiddleware } from "@/middleware/auth";
import { projectContextMiddleware } from "@/middleware/project-context";
import type { Env } from "@/types/env";
import {
  connectPrivateChannelInstance,
  createChannel,
  deleteChannel,
  deletePrivateChannelInstance,
  disconnectPrivateChannelInstance,
  getChannel,
  getPrivateChannelHealth,
  getPrivateChannelInstance,
  getPrivateChannelOverview,
  listChannelEvents,
  listChannels,
  listProjectEvents,
  probePrivateChannelConnection,
} from "./handlers";

const privateChannels = new Hono<{ Bindings: Env }>();

/**
 * Router-wide gate: 403 FORBIDDEN unless the feature flag is enabled. Applied
 * once as middleware so every current and future route inherits it. Kept separate
 * from "is an instance configured/ready" (that check belongs to the handlers).
 */
async function requirePrivateChannelsFeature(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isPrivateChannelsEnabled(c.env)) {
    throw new AppError("FORBIDDEN", "Private Channels are not enabled for this environment.");
  }
  await next();
}

privateChannels.use("*", requirePrivateChannelsFeature);
privateChannels.use("*", unifiedAuthMiddleware({ allowClerk: true, allowSession: true }));
privateChannels.use("*", projectContextMiddleware());

// --- /health --------------------------------------------------------------
// Gateway-only probe of a caller-supplied URL. Returns PrivateChannelHealth DTO.
privateChannels.get("/health", requirePermissions("payments:read"), getPrivateChannelHealth);

// --- /probe ---------------------------------------------------------------
// Full connect-time probe (gateway + chain RPC). What the connect flow's
// re-probe runs; wired here so the web's Test-connection matches Connect.
privateChannels.post("/probe", requirePermissions("payments:read"), probePrivateChannelConnection);

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
instance.get("/overview", requirePermissions("payments:read"), getPrivateChannelOverview);
privateChannels.route("/instance", instance);

// --- /events --------------------------------------------------------------
privateChannels.get("/events", requirePermissions("payments:read"), listProjectEvents);

// --- /channels ------------------------------------------------------------
// Logical channels: instance-scoped metadata, enforced entirely by SDP.
privateChannels.get("/channels", requirePermissions("payments:read"), listChannels);
privateChannels.post("/channels", requirePermissions("payments:write"), createChannel);
privateChannels.get("/channels/:id", requirePermissions("payments:read"), getChannel);
privateChannels.get("/channels/:id/events", requirePermissions("payments:read"), listChannelEvents);
privateChannels.delete("/channels/:id", requirePermissions("payments:write"), deleteChannel);

export default privateChannels;
