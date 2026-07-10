import { assertValidAddress } from "@sdp/solana/address";
import type { Permission } from "@sdp/types";
import type { Address } from "@solana/kit";
import type { Context } from "hono";
import { badRequest, notFound } from "@/lib/errors";
import { resolveScope, resolveWalletAddress } from "@/routes/payments/wallets";
import { assertApiKeyWalletAccess } from "@/services/api-key-scope.service";
import type { CustodyWallet } from "@/services/stores/custody-config.store";
import type { Env } from "@/types/env";

/** Hono request context bound to the app `Env`. */
export type AppContext = Context<{ Bindings: Env }>;

/**
 * Resolve an SDP-managed custody wallet by id or pubkey within the caller's
 * scope. Money-moving pathways require a managed wallet so custody can sign.
 * Reuses the shared `resolveScope` and applies `assertApiKeyWalletAccess`
 * (a no-op for Clerk/session auth) so a wallet-scoped API key cannot act on a
 * wallet it is not bound to.
 */
export async function resolveManagedWallet(
  c: AppContext,
  walletIdOrAddress: string,
  requiredWalletPermissions: Permission[] = []
): Promise<CustodyWallet> {
  const { auth, wallets } = await resolveScope(c);
  const wallet = wallets.find(
    (entry) => entry.walletId === walletIdOrAddress || entry.publicKey === walletIdOrAddress
  );
  if (!wallet) {
    throw notFound("Wallet not found. Provision wallets through /v1/wallets");
  }
  assertApiKeyWalletAccess(auth, wallet.walletId, requiredWalletPermissions);
  return wallet;
}

/**
 * Resolve a wallet pubkey for reads: a managed wallet's pubkey (with the API-key
 * wallet-access assertion) or a raw Solana address (reads are open to any
 * address). Delegates to the shared `resolveWalletAddress`.
 */
export async function resolveReadWalletPubkey(
  c: AppContext,
  walletIdOrAddress: string,
  requiredWalletPermissions: Permission[] = []
): Promise<Address> {
  const { auth, wallets } = await resolveScope(c);
  return resolveWalletAddress(
    wallets,
    walletIdOrAddress,
    "wallet",
    auth,
    requiredWalletPermissions
  ) as Address;
}

/** Validate a request-supplied Solana address, mapping failures to a 400. */
export function requireAddress(value: string, field: string): Address {
  try {
    return assertValidAddress(value, field);
  } catch {
    throw badRequest(`Invalid Solana address for ${field}: ${value}`);
  }
}
