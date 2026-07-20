import type { AppDb } from "@/db";
import {
  generatePrivateChannelVerifiedWalletId,
  mapPrivateChannelVerifiedWalletRow,
  type PrivateChannelVerifiedWalletRepository,
  type UpsertVerifiedWalletInput,
  type VerifiedWalletScope,
} from "./private-channel-verified-wallet.repository";

export function createPostgresPrivateChannelVerifiedWalletRepository(
  db: AppDb
): PrivateChannelVerifiedWalletRepository {
  return {
    async upsert(input: UpsertVerifiedWalletInput) {
      const row = await db
        .prepare(
          `INSERT INTO private_channel_verified_wallets (
               id, organization_id, project_id, user_id, instance_id,
               wallet_id, pubkey
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (organization_id, project_id, user_id, pubkey) DO UPDATE
               SET instance_id = excluded.instance_id,
                   wallet_id = excluded.wallet_id,
                   verified_at = sdp_iso_now(),
                   updated_at = sdp_iso_now()
          RETURNING *`
        )
        .bind(
          generatePrivateChannelVerifiedWalletId(),
          input.organizationId,
          input.projectId,
          input.userId,
          input.instanceId,
          input.walletId,
          input.pubkey
        )
        .first<Record<string, unknown>>();
      if (!row) {
        throw new Error("Failed to persist verified wallet");
      }
      return mapPrivateChannelVerifiedWalletRow(row);
    },

    async deleteByScopeAndPubkey(scope: VerifiedWalletScope, userId: string, pubkey: string) {
      const row = await db
        .prepare(
          `DELETE FROM private_channel_verified_wallets
             WHERE organization_id = ?
               AND project_id = ?
               AND user_id = ?
               AND pubkey = ?
          RETURNING id`
        )
        .bind(scope.organizationId, scope.projectId, userId, pubkey)
        .first<Record<string, unknown>>();
      return row !== null;
    },

    async listByProjectAndUser(scope: VerifiedWalletScope, userId: string) {
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_verified_wallets
             WHERE organization_id = ?
               AND project_id = ?
               AND user_id = ?
             ORDER BY verified_at DESC`
        )
        .bind(scope.organizationId, scope.projectId, userId)
        .all<Record<string, unknown>>();
      return (result.results ?? []).map(mapPrivateChannelVerifiedWalletRow);
    },
  };
}
