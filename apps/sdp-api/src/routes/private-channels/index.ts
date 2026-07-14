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
  getPrivateChannelInstance,
} from "./handlers";

const privateChannels = new Hono<{ Bindings: Env }>();

async function requirePrivateChannelsFeature(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isPrivateChannelsEnabled(c.env)) {
    throw new AppError("FORBIDDEN", "Private Channels are not enabled for this environment");
  }
  await next();
}

// Middleware applies to every sub-route. Future sub-features (channels, members,
// deposit-intents, transfer-intents, withdrawal-intents, events) mount under
// the same base and inherit this stack — see PROPOSAL.md §5.
privateChannels.use("*", requirePrivateChannelsFeature);
privateChannels.use("*", unifiedAuthMiddleware({ allowClerk: true, allowSession: true }));
privateChannels.use("*", projectContextMiddleware());

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
