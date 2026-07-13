import { badRequest } from "@/lib/errors";
import { success } from "@/lib/response";
import { probeInstanceHealth } from "@/services/private-channels";
import type { AppContext } from "../context";
import { healthQuerySchema } from "../schemas";

/**
 * GET /health — probe a candidate gateway's `/health` + `/ready` (a pre-connect
 * test of a user-supplied URL, so it runs even before an instance is configured).
 * Always responds 200 with the `PrivateChannelHealth` DTO for every probe outcome
 * (ready/degraded/unreachable); only a missing `gatewayUrl` is a 400. The DTO
 * omits upstream response bodies by construction.
 *
 * Note: per product decision the probe does NOT block private/loopback hosts
 * (self-host operators may run internal gateways). It stays behind sdp-api auth
 * + `payments:read`, on the Worker, with `redirect: "manual"` in the probe. If a
 * multi-tenant deployment needs SSRF hardening, add an env-gated private-host
 * block in `probeGatewayHealth`.
 */
export async function getPrivateChannelHealth(c: AppContext) {
  const parsed = healthQuerySchema.safeParse({ gatewayUrl: c.req.query("gatewayUrl") });
  if (!parsed.success) {
    throw badRequest("gatewayUrl query parameter is required");
  }
  return success(c, await probeInstanceHealth(parsed.data.gatewayUrl));
}
