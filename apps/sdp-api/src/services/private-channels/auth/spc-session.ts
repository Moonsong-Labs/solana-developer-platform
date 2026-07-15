/**
 * POC Clerk → SPC session bridge.
 *
 * ⚠️ THROWAWAY POC. Real SPC auth infrastructure (proper user provisioning,
 * credential storage, JWT lifecycle) is a separate future effort. This shim
 * exists only to unblock the wallet challenge/verify flow now.
 *
 * SDP auth (Clerk JWT) and SPC auth (its own HS256 JWT) are unrelated systems —
 * the Clerk token is NOT reusable as an SPC token. So we derive a *deterministic*
 * SPC user from the already-Clerk-authenticated SDP (org, project) identity and
 * `register`+`login` against the connected instance's auth service to obtain an
 * SPC-issued JWT. SDP never holds the SPC JWT secret; SPC issues the token.
 */

import { PrivateChannelError } from "@sdp/private-channels";
import type { SpcAuthClient } from "@sdp/private-channels/auth";
import { hashString } from "@/lib/hash";
import type { Env } from "@/types/env";

/** The Clerk-authenticated SDP scope the SPC user is derived from. */
export interface SpcSessionScope {
  organizationId: string;
  projectId: string;
}

export interface SpcSession {
  /** SPC-issued JWT (24h) for challenge/verify calls. */
  token: string;
  /** The derived SPC username the wallet is verified under. */
  username: string;
}

/**
 * Derive a stable, charset/length-safe SPC username from the SDP scope. SPC
 * usernames must be 5–32 chars of `[A-Za-z0-9_-]`; the raw org/project ids blow
 * past 32, so we hash them. `sdp_` + 24 hex chars = 28 chars.
 */
async function deriveUsername(scope: SpcSessionScope, secret: string): Promise<string> {
  const digest = await hashString(`${scope.organizationId}:${scope.projectId}`, secret);
  return `sdp_${digest.slice(0, 24)}`;
}

/**
 * Get an SPC-issued JWT for the current SDP request's (org, project). Registers
 * the derived user idempotently (a 409 means it already exists), then logs in.
 * Stateless: no JWT caching in this POC.
 */
export async function getSpcSession(
  env: Env,
  scope: SpcSessionScope,
  client: SpcAuthClient
): Promise<SpcSession> {
  const secret = env.PRIVATE_CHANNEL_POC_AUTH_SECRET;
  if (!secret) {
    throw new PrivateChannelError(
      "AUTH_UNAVAILABLE",
      "PRIVATE_CHANNEL_POC_AUTH_SECRET is not configured; cannot establish an SPC session."
    );
  }

  const username = await deriveUsername(scope, secret);
  const password = await hashString(username, secret);

  try {
    await client.register({ username, password });
  } catch (error) {
    // A taken username means the proxy user already exists — expected on repeat calls.
    if (!(error instanceof PrivateChannelError) || error.code !== "CONFLICT") {
      throw error;
    }
  }

  const { token } = await client.login({ username, password });
  return { token, username };
}
