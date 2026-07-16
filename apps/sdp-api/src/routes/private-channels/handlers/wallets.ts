import type { PrivateChannelVerifiedWalletDto } from "@sdp/types";
import {
  createPrivateChannelVerifiedWalletRepository,
  type PrivateChannelVerifiedWalletRow,
} from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { success } from "@/lib/response";
import type { AppContext } from "../context";

function toVerifiedWalletDto(
  row: PrivateChannelVerifiedWalletRow
): PrivateChannelVerifiedWalletDto {
  return {
    id: row.id,
    walletId: row.wallet_id,
    pubkey: row.pubkey,
    verifiedAt: row.verified_at,
  };
}

/** GET /wallets — list the project's verified wallets. */
export async function listVerifiedWallets(c: AppContext) {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const rows = await createPrivateChannelVerifiedWalletRepository(c.env).listByProject({
    organizationId: auth.organizationId,
    projectId,
  });
  return success(c, { wallets: rows.map(toVerifiedWalletDto) });
}
