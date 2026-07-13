/**
 * SPC instance config resolution.
 *
 * Reads `PRIVATE_CHANNEL_*` from a structural env (never `process.env`), the
 * same discipline as `@sdp/rpc`/`@sdp/solana`. The sdp-api service and the e2e
 * harness each pass their own env in.
 */

import { assertValidAddress } from "@sdp/solana/address";
import { badRequest } from "./errors";
import type { PrivateChannelConfig, PrivateChannelNetwork } from "./types";
import { assertHttpUrl } from "./url";

/** Structural env subset the SPC client reads. */
export interface PrivateChannelEnv {
  /** JSON-RPC gateway base URL (`:8899`); its presence enables the feature. */
  PRIVATE_CHANNEL_GATEWAY_URL?: string;
  /** RBAC mode; `"jwt"` enables JWT-gated reads, anything else is `"none"`. */
  PRIVATE_CHANNEL_AUTH_MODE?: string;
  /** Escrow program id (L1); validated as an address when set. */
  PRIVATE_CHANNEL_ESCROW_PROGRAM_ID?: string;
  /** Withdraw program id (channel); validated as an address when set. */
  PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID?: string;
  /** Escrow instance address; validated as an address when set. */
  PRIVATE_CHANNEL_ESCROW_INSTANCE?: string;
  /** Canonical channel USDC mint; validated as an address when set. */
  PRIVATE_CHANNEL_USDC_MINT?: string;
  /** Cluster selector; `"mainnet-beta"` → mainnet, otherwise devnet. */
  SOLANA_NETWORK?: string;
}

/** Trim a value, returning undefined for null/blank so `??` fallbacks work. */
function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v !== "" ? v : undefined;
}

/** True when a gateway URL is configured (feature is otherwise off). */
export function isPrivateChannelConfigured(env: PrivateChannelEnv): boolean {
  return !!trimmed(env.PRIVATE_CHANNEL_GATEWAY_URL);
}

/**
 * Resolve a full `PrivateChannelConfig` from env. Requires `PRIVATE_CHANNEL_GATEWAY_URL`
 * (throws `BAD_REQUEST` otherwise); validates every URL and address, and leaves
 * optional facts unset when absent.
 */
export function resolvePrivateChannelConfig(env: PrivateChannelEnv): PrivateChannelConfig {
  const gatewayUrl = trimmed(env.PRIVATE_CHANNEL_GATEWAY_URL);
  if (!gatewayUrl) {
    throw badRequest("PRIVATE_CHANNEL_GATEWAY_URL is not set.");
  }

  const network: PrivateChannelNetwork =
    env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const authMode = trimmed(env.PRIVATE_CHANNEL_AUTH_MODE) === "jwt" ? "jwt" : "none";

  const escrowProgramId = trimmed(env.PRIVATE_CHANNEL_ESCROW_PROGRAM_ID);
  const withdrawProgramId = trimmed(env.PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ID);
  const escrowInstance = trimmed(env.PRIVATE_CHANNEL_ESCROW_INSTANCE);
  const usdcMint = trimmed(env.PRIVATE_CHANNEL_USDC_MINT);

  return {
    gatewayUrl: assertHttpUrl(gatewayUrl, "PRIVATE_CHANNEL_GATEWAY_URL"),
    authMode,
    network,
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
