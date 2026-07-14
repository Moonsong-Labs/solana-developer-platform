/**
 * Solana Private Channels (SPC) — integration test helpers.
 *
 * Thin wrapper over `@sdp/private-channels`: builds the SPC env from `#env-impl`
 * and exposes the resolved config + configured flag. Deliberately app-free
 * (imports only `@sdp/private-channels`), so the connectivity suite doesn't drag
 * the SDP app into its module graph.
 *
 * Run:
 *   pnpm test:private-channels
 * Override the target instance:
 *   PRIVATE_CHANNEL_GATEWAY_URL=http://host:8899 pnpm test:private-channels
 */

import {
  isPrivateChannelConfigured,
  type PrivateChannelConfig,
  type PrivateChannelEnv,
  resolvePrivateChannelConfig,
} from "@sdp/private-channels";
import { env } from "#env-impl";

export const RUN_INTEGRATION_TESTS = env.RUN_INTEGRATION_TESTS === "true";

function spcEnv(): PrivateChannelEnv {
  const e = env as Record<string, unknown>;
  const s = (key: string): string | undefined =>
    typeof e[key] === "string" ? (e[key] as string) : undefined;
  return {
    PRIVATE_CHANNEL_GATEWAY_URL: s("PRIVATE_CHANNEL_GATEWAY_URL"),
    PRIVATE_CHANNEL_AUTH_MODE: s("PRIVATE_CHANNEL_AUTH_MODE"),
    PRIVATE_CHANNEL_ESCROW_PROGRAM_ID: s("PRIVATE_CHANNEL_ESCROW_PROGRAM_ID"),
    PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID: s("PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID"),
    PRIVATE_CHANNEL_ESCROW_INSTANCE: s("PRIVATE_CHANNEL_ESCROW_INSTANCE"),
    PRIVATE_CHANNEL_USDC_MINT: s("PRIVATE_CHANNEL_USDC_MINT"),
    SOLANA_NETWORK: s("SOLANA_NETWORK"),
  };
}

export const PRIVATE_CHANNEL_CONFIGURED = isPrivateChannelConfigured(spcEnv());

export function getPrivateChannelConfig(): PrivateChannelConfig {
  return resolvePrivateChannelConfig(spcEnv());
}
