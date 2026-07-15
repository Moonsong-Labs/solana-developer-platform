import type { PrivateChannelVerifiedWalletDto } from "@sdp/types";
import type { PrivateChannelVerifiedWalletRow } from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import { success } from "@/lib/response";
import { mapPrivateChannelError } from "@/services/private-channels";
import {
  listPrivateChannelVerifiedWallets,
  verifyPrivateChannelWallet,
} from "@/services/private-channels/verification";
import type { AppContext } from "../context";
import { verifyWalletParamsSchema } from "../schemas";

function toVerifiedWalletDto(
  row: PrivateChannelVerifiedWalletRow
): PrivateChannelVerifiedWalletDto {
  return {
    id: row.id,
    walletId: row.wallet_id,
    pubkey: row.pubkey,
    status: row.status,
    verifiedAt: row.verified_at,
  };
}

/**
 * POST /wallets/:walletId/verify — run the SPC challenge → sign → verify
 * handshake for a custody wallet, then persist the verification. Idempotent.
 */
export async function verifyWallet(c: AppContext) {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const parsed = verifyWalletParamsSchema.safeParse({ walletId: c.req.param("walletId") });
  if (!parsed.success) {
    throw badRequest("walletId is required");
  }

  try {
    const row = await verifyPrivateChannelWallet(c.env, auth, projectId, parsed.data.walletId);
    return success(c, { wallet: toVerifiedWalletDto(row) });
  } catch (error) {
    throw mapPrivateChannelError(error);
  }
}

/** GET /wallets — list the project's verified wallets. */
export async function listVerifiedWallets(c: AppContext) {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const rows = await listPrivateChannelVerifiedWallets(c.env, auth, projectId);
  return success(c, { wallets: rows.map(toVerifiedWalletDto) });
}
