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
    async getByScopeAndPubkey(scope: VerifiedWalletScope, pubkey: string) {
      const row = await db
        .prepare(
          `SELECT * FROM private_channel_verified_wallets
             WHERE organization_id = ?
               AND project_id = ?
               AND pubkey = ?`
        )
        .bind(scope.organizationId, scope.projectId, pubkey)
        .first<Record<string, unknown>>();
      return row ? mapPrivateChannelVerifiedWalletRow(row) : null;
    },

    async upsert(input: UpsertVerifiedWalletInput) {
      const row = await db
        .prepare(
          `INSERT INTO private_channel_verified_wallets (
               id, organization_id, project_id, instance_id,
               wallet_id, pubkey, spc_username, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
             ON CONFLICT (organization_id, project_id, pubkey) DO UPDATE
               SET instance_id = excluded.instance_id,
                   wallet_id = excluded.wallet_id,
                   spc_username = excluded.spc_username,
                   status = 'active',
                   verified_at = sdp_iso_now(),
                   updated_at = sdp_iso_now()
          RETURNING *`
        )
        .bind(
          generatePrivateChannelVerifiedWalletId(),
          input.organizationId,
          input.projectId,
          input.instanceId,
          input.walletId,
          input.pubkey,
          input.spcUsername
        )
        .first<Record<string, unknown>>();
      if (!row) {
        throw new Error("Failed to persist verified wallet");
      }
      return mapPrivateChannelVerifiedWalletRow(row);
    },

    async listByProject(scope: VerifiedWalletScope) {
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_verified_wallets
             WHERE organization_id = ?
               AND project_id = ?
               AND status = 'active'
             ORDER BY verified_at DESC`
        )
        .bind(scope.organizationId, scope.projectId)
        .all<Record<string, unknown>>();
      return (result.results ?? []).map(mapPrivateChannelVerifiedWalletRow);
    },
  };
}
