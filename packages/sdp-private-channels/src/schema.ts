import type { PrivateChannelInstanceInput } from "@sdp/types";
import { z } from "zod";

// Solana base58 pubkey: same regex used across the SDP codebase (see
// apps/sdp-web/src/app/dashboard/custody/actions.ts:9).
const BASE58_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrl = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine(isHttpUrl, `${label} must be a valid http/https URL.`);

const base58Address = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .regex(BASE58_PUBKEY_RE, `${label} must be a base58 Solana address.`);

/**
 * Single source of truth for validating the private-channel connect form.
 * The API handler and the client form both call `.safeParse` on this schema.
 *
 * `authUrl` is required and must be a valid http/https URL only when
 * `useAuth === true`; when false, `authUrl` is normalized to the empty string.
 */
export const privateChannelInstanceInputSchema = z
  .object({
    gatewayUrl: httpUrl("Gateway URL"),
    chainRpcUrl: httpUrl("Chain RPC URL"),
    escrowProgramId: base58Address("Escrow program ID"),
    withdrawProgramId: base58Address("Withdraw program ID"),
    escrowInstanceAddr: base58Address("Escrow instance address"),
    useAuth: z.boolean(),
    authUrl: z.string().trim().default(""),
  })
  .superRefine((value, ctx) => {
    if (value.useAuth) {
      if (!value.authUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["authUrl"],
          message: "Auth URL is required when Use auth is enabled.",
        });
      } else if (!isHttpUrl(value.authUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["authUrl"],
          message: "Auth URL must be a valid http/https URL.",
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    authUrl: value.useAuth ? value.authUrl : "",
  })) satisfies z.ZodType<PrivateChannelInstanceInput>;

export type PrivateChannelInstanceInputSchema = typeof privateChannelInstanceInputSchema;
