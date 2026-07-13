/**
 * Solana Private Channels (SPC) — integration test helpers.
 *
 * Thin wrapper over `@sdp/private-channels`: the library IS the client, so these helpers just
 * build the SPC env from `#env-impl` and expose the gateway client + config.
 * Deliberately app-free (imports only `@sdp/private-channels`), so the connectivity/balance
 * suites don't drag the SDP app into their module graph.
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
  createGatewayRpc as spcCreateGatewayRpc,
} from "@sdp/private-channels";
import type { SolanaRpc } from "@sdp/rpc/solana";
import { env } from "#env-impl";

export const RUN_INTEGRATION_TESTS = env.RUN_INTEGRATION_TESTS === "true";

function spcEnv(): PrivateChannelEnv {
  const e = env as Record<string, unknown>;
  const s = (key: string): string | undefined =>
    typeof e[key] === "string" ? (e[key] as string) : undefined;
  return {
    PRIVATE_CHANNEL_GATEWAY_URL: s("PRIVATE_CHANNEL_GATEWAY_URL"),
    PRIVATE_CHANNEL_AUTH_BASE_URL: s("PRIVATE_CHANNEL_AUTH_BASE_URL"),
    PRIVATE_CHANNEL_AUTH_MODE: s("PRIVATE_CHANNEL_AUTH_MODE"),
    PRIVATE_CHANNEL_ESCROW_PROGRAM_ID: s("PRIVATE_CHANNEL_ESCROW_PROGRAM_ID"),
    PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID: s("PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID"),
    PRIVATE_CHANNEL_ESCROW_INSTANCE: s("PRIVATE_CHANNEL_ESCROW_INSTANCE"),
    PRIVATE_CHANNEL_USDC_MINT: s("PRIVATE_CHANNEL_USDC_MINT"),
    SOLANA_NETWORK: s("SOLANA_NETWORK"),
  };
}

export const PRIVATE_CHANNEL_CONFIGURED = isPrivateChannelConfigured(spcEnv());

/** Transfer suite also needs a custody key + a mint to move. */
export const PRIVATE_CHANNEL_TRANSFER_CONFIGURED =
  PRIVATE_CHANNEL_CONFIGURED &&
  !!(env as { CUSTODY_PRIVATE_KEY?: string }).CUSTODY_PRIVATE_KEY &&
  !!(env as { PRIVATE_CHANNEL_USDC_MINT?: string }).PRIVATE_CHANNEL_USDC_MINT;

export function getPrivateChannelConfig(): PrivateChannelConfig {
  return resolvePrivateChannelConfig(spcEnv());
}

export function getUsdcMint(): string | undefined {
  return (env as { PRIVATE_CHANNEL_USDC_MINT?: string }).PRIVATE_CHANNEL_USDC_MINT;
}

export function getCustodyPrivateKey(): string | undefined {
  return (env as { CUSTODY_PRIVATE_KEY?: string }).CUSTODY_PRIVATE_KEY;
}

/** SDP's RPC client pointed at the gateway (optional Bearer for the auth-ON path). */
export function createGatewayRpc(options?: { bearer?: string }): SolanaRpc {
  return spcCreateGatewayRpc(getPrivateChannelConfig(), options);
}

type JsonRpcResult<T> =
  | { jsonrpc: "2.0"; id: number; result: T }
  | { jsonrpc: "2.0"; id: number; error: { code: number; message: string; data?: unknown } };

/**
 * Raw JSON-RPC POST to the gateway. Still needed to assert methods the gateway
 * does NOT implement (e.g. getVersion → -32601), which the typed client hides.
 */
export async function rawGatewayRpc<T = unknown>(
  method: string,
  params: unknown[] = []
): Promise<JsonRpcResult<T>> {
  const res = await fetch(getPrivateChannelConfig().gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()) as JsonRpcResult<T>;
}
