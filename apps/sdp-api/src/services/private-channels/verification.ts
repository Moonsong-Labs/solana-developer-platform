/**
 * SPC wallet-verification orchestration.
 *
 * Drives the SPC auth handshake for one SDP custody wallet:
 *   1. resolve the connected (auth-enabled) instance + the wallet's pubkey
 *   2. get an SPC session JWT (POC Clerk→SPC bridge)
 *   3. `challenge-wallet` → sign the challenge with THAT wallet → `verify-wallet`
 *   4. persist the verification (idempotent per project scope)
 *
 * Signing is wallet-specific via `createOrgSigner(...walletId)` (not
 * `SigningService.sign`, which signs with the scope-default wallet). The
 * resolved signer is a message-partial-signer at runtime; we sign the challenge
 * as raw bytes — matching SPC's `signature.verify(pubkey, message.as_bytes())`.
 */

import { createAuthClient } from "@sdp/private-channels/auth";
import { getBase58Codec } from "@solana/codecs";
import type { Address } from "@solana/kit";
import { createSignableMessage, isMessagePartialSigner } from "@solana/signers";
import {
  createPrivateChannelInstanceRepository,
  createPrivateChannelVerifiedWalletRepository,
  type PrivateChannelVerifiedWalletRow,
} from "@/db/repositories";
import type { ApiKeyContext } from "@/lib/auth";
import { AppError, walletNotFound } from "@/lib/errors";
import { assertApiKeyWalletAccess } from "@/services/api-key-scope.service";
import { createSigningService } from "@/services/domain/signing.service";
import { createOrgSigner } from "@/services/solana/signer";
import type { Env } from "@/types/env";
import { getSpcSession } from "./auth/spc-session";

const base58 = getBase58Codec();

/**
 * Verify one custody wallet with the connected SPC instance's auth service.
 * Returns the persisted verification row (idempotent: re-verifying an already
 * active wallet in this scope short-circuits and returns the existing row).
 */
export async function verifyPrivateChannelWallet(
  env: Env,
  auth: ApiKeyContext,
  projectId: string,
  walletId: string
): Promise<PrivateChannelVerifiedWalletRow> {
  const scope = { organizationId: auth.organizationId, projectId };

  const instance = await createPrivateChannelInstanceRepository(env).getActiveByProject(scope);
  if (!instance) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "No active Private Channels instance is connected for this project."
    );
  }
  if (!instance.use_auth || !instance.auth_url) {
    throw new AppError(
      "BAD_REQUEST",
      "Wallet verification requires the connected instance to have auth enabled."
    );
  }

  // Resolve the wallet's pubkey and authorize the caller for it.
  const wallet = await createSigningService(env).getWalletById(
    auth.organizationId,
    projectId,
    walletId
  );
  if (!wallet) {
    throw walletNotFound();
  }
  assertApiKeyWalletAccess(auth, wallet.walletId, []);
  const pubkey = wallet.publicKey;

  const verifiedRepo = createPrivateChannelVerifiedWalletRepository(env);

  // Idempotency: already verified in this scope → return the existing record.
  const existing = await verifiedRepo.getByScopeAndPubkey(scope, pubkey);
  if (existing && existing.status === "active") {
    return existing;
  }

  const client = createAuthClient(instance.auth_url);
  const session = await getSpcSession(env, scope, client);

  const challenge = await client.challengeWallet(session.token);

  // Sign the challenge with the specific wallet being verified.
  const signer = await createOrgSigner(env, auth.organizationId, projectId, walletId);
  if (signer.address !== pubkey) {
    throw new AppError(
      "SIGNING_FAILED",
      "Resolved signer does not match the wallet being verified."
    );
  }
  if (!isMessagePartialSigner(signer)) {
    throw new AppError(
      "SIGNING_FAILED",
      `Wallet provider (${wallet.provider}) cannot sign verification messages.`
    );
  }

  let signature: string;
  try {
    const [signatures] = await signer.signMessages([createSignableMessage(challenge.message)]);
    const signatureBytes = signatures[pubkey as Address];
    if (!signatureBytes) {
      throw new AppError("SIGNING_FAILED", "Signing did not produce a signature for the wallet.");
    }
    signature = base58.decode(signatureBytes);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "SIGNING_FAILED",
      `Wallet provider (${wallet.provider}) failed to sign the verification challenge.`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  await client.verifyWallet(session.token, {
    pubkey,
    nonce: challenge.nonce,
    signature,
  });

  return verifiedRepo.upsert({
    ...scope,
    instanceId: instance.id,
    walletId: wallet.walletId,
    pubkey,
    spcUsername: session.username,
  });
}

/** List the project's active verified wallets. */
export async function listPrivateChannelVerifiedWallets(
  env: Env,
  auth: ApiKeyContext,
  projectId: string
): Promise<PrivateChannelVerifiedWalletRow[]> {
  return createPrivateChannelVerifiedWalletRepository(env).listByProject({
    organizationId: auth.organizationId,
    projectId,
  });
}
