/**
 * Solana Private Channels (SPC) — integration test helpers.
 *
 * App-free (imports only `#env-impl`), so the gateway connectivity suite doesn't
 * drag the SDP app into its module graph. The live sandbox gateway URL is read
 * straight from the test env — the app itself no longer uses env config (the
 * connection is persisted per project), but a live-endpoint test legitimately
 * targets a URL from its environment.
 *
 * Run (with the gateway reachable):
 *   RUN_INTEGRATION_TESTS=true \
 *   PRIVATE_CHANNEL_GATEWAY_URL=http://34.71.147.163:8899 \
 *     pnpm --filter @sdp/api-integration test
 */

import { env } from "#env-impl";

export const RUN_INTEGRATION_TESTS = env.RUN_INTEGRATION_TESTS === "true";

const rawGatewayUrl = (env as Record<string, unknown>).PRIVATE_CHANNEL_GATEWAY_URL;
const GATEWAY_URL = typeof rawGatewayUrl === "string" ? rawGatewayUrl : "";

export const PRIVATE_CHANNEL_CONFIGURED = GATEWAY_URL.length > 0;

/** The live SPC gateway base URL under test. */
export function getGatewayUrl(): string {
  return GATEWAY_URL;
}
