/**
 * SPC instance config resolution.
 *
 * Reads `PRIVATE_CHANNEL_*` from a structural env (never `process.env`), the
 * same discipline as `@sdp/rpc`/`@sdp/solana`. The sdp-api service and the e2e
 * harness each pass their own env in.
 */

import { assertValidAddress } from "@sdp/solana/address";
import { badRequest } from "./errors";
import type { SpcInstanceConfig, SpcNetwork } from "./types";

/** Structural env subset the SPC client reads. */
export interface SpcEnv {
  /** JSON-RPC gateway base URL (`:8899`); its presence enables the feature. */
  PRIVATE_CHANNEL_GATEWAY_URL?: string;
  /** Auth service base URL (`:8903`), when the instance exposes it. */
  PRIVATE_CHANNEL_AUTH_BASE_URL?: string;
  /** RBAC mode; `"on"` enables JWT-gated reads, anything else is `"off"`. */
  PRIVATE_CHANNEL_AUTH_MODE?: string;
  /** Escrow program id (L1); validated as an address when set. */
  PRIVATE_CHANNEL_ESCROW_PROGRAM_ID?: string;
  /** Withdraw program id (channel); validated as an address when set. */
  PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID?: string;
  /** Escrow instance address; validated as an address when set. */
  PRIVATE_CHANNEL_ESCROW_INSTANCE?: string;
  /** Canonical channel USDC mint; validated as an address when set. */
  PRIVATE_CHANNEL_USDC_MINT?: string;
  /** L1 RPC for escrow legs; falls back to `SOLANA_RPC_URL`. */
  PRIVATE_CHANNEL_L1_RPC_URL?: string;
  /** Shared Solana RPC URL, used as the L1 fallback. */
  SOLANA_RPC_URL?: string;
  /** Cluster selector; `"mainnet-beta"` → mainnet, otherwise devnet. */
  SOLANA_NETWORK?: string;
}

/** Trim a value, returning undefined for null/blank so `??` fallbacks work. */
function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v !== "" ? v : undefined;
}

/** Return `value` if it parses as a URL, else throw a `BAD_REQUEST` naming `field`. */
function assertUrl(value: string, field: string): string {
  try {
    new URL(value);
  } catch {
    throw badRequest(`Invalid URL for ${field}: ${value}`);
  }
  return value;
}

/** True when a gateway URL is configured (feature is otherwise off). */
export function isSpcConfigured(env: SpcEnv): boolean {
  return !!trimmed(env.PRIVATE_CHANNEL_GATEWAY_URL);
}

/**
 * Resolve a full `SpcInstanceConfig` from env. Requires `PRIVATE_CHANNEL_GATEWAY_URL`
 * (throws `BAD_REQUEST` otherwise); validates every URL and address, and leaves
 * optional facts unset when absent.
 */
export function resolveSpcConfig(env: SpcEnv): SpcInstanceConfig {
  const gatewayUrl = trimmed(env.PRIVATE_CHANNEL_GATEWAY_URL);
  if (!gatewayUrl) {
    throw badRequest("PRIVATE_CHANNEL_GATEWAY_URL is not set.");
  }

  const network: SpcNetwork = env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const authMode = trimmed(env.PRIVATE_CHANNEL_AUTH_MODE) === "on" ? "on" : "off";

  const authBaseUrl = trimmed(env.PRIVATE_CHANNEL_AUTH_BASE_URL);
  const l1RpcUrl = trimmed(env.PRIVATE_CHANNEL_L1_RPC_URL) ?? trimmed(env.SOLANA_RPC_URL);
  const escrowProgramId = trimmed(env.PRIVATE_CHANNEL_ESCROW_PROGRAM_ID);
  const withdrawProgramId = trimmed(env.PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID);
  const escrowInstance = trimmed(env.PRIVATE_CHANNEL_ESCROW_INSTANCE);
  const usdcMint = trimmed(env.PRIVATE_CHANNEL_USDC_MINT);

  return {
    gatewayUrl: assertUrl(gatewayUrl, "PRIVATE_CHANNEL_GATEWAY_URL"),
    authMode,
    network,
    ...(authBaseUrl
      ? { authBaseUrl: assertUrl(authBaseUrl, "PRIVATE_CHANNEL_AUTH_BASE_URL") }
      : {}),
    ...(l1RpcUrl ? { l1RpcUrl: assertUrl(l1RpcUrl, "PRIVATE_CHANNEL_L1_RPC_URL") } : {}),
    ...(escrowProgramId
      ? {
          escrowProgramId: assertValidAddress(escrowProgramId, "PRIVATE_CHANNEL_ESCROW_PROGRAM_ID"),
        }
      : {}),
    ...(withdrawProgramId
      ? {
          withdrawProgramId: assertValidAddress(
            withdrawProgramId,
            "PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID"
          ),
        }
      : {}),
    ...(escrowInstance
      ? { escrowInstance: assertValidAddress(escrowInstance, "PRIVATE_CHANNEL_ESCROW_INSTANCE") }
      : {}),
    ...(usdcMint ? { usdcMint: assertValidAddress(usdcMint, "PRIVATE_CHANNEL_USDC_MINT") } : {}),
  };
}
