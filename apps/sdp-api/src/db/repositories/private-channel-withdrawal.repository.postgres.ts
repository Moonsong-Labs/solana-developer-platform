import type { AppDb } from "@/db";
import {
  type CreateWithdrawalInput,
  generatePrivateChannelWithdrawalId,
  type ListWithdrawalsByStatusInput,
  type PrivateChannelWithdrawalRepository,
  type PrivateChannelWithdrawalRow,
  type UpdateWithdrawalInput,
  type WithdrawalProjectScope,
} from "./private-channel-withdrawal.repository";

function mapRow(row: Record<string, unknown>): PrivateChannelWithdrawalRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    project_id: row.project_id as string,
    instance_id: row.instance_id as string,
    wallet_id: row.wallet_id as string,
    owner: row.owner as string,
    destination: row.destination as string,
    mint: row.mint as string,
    amount: row.amount as string,
    private_channel_user_id: (row.private_channel_user_id ?? null) as string | null,
    gateway_url: (row.gateway_url ?? "") as string,
    chain_rpc_url: (row.chain_rpc_url ?? "") as string,
    escrow_program_id: (row.escrow_program_id ?? "") as string,
    escrow_instance_addr: (row.escrow_instance_addr ?? "") as string,
    status: row.status as PrivateChannelWithdrawalRow["status"],
    burn_signature: (row.burn_signature ?? null) as string | null,
    release_signature: (row.release_signature ?? null) as string | null,
    failure_reason: (row.failure_reason ?? null) as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createPostgresPrivateChannelWithdrawalRepository(
  db: AppDb
): PrivateChannelWithdrawalRepository {
  return {
    async createWithdrawal(input: CreateWithdrawalInput) {
      const row = await db
        .prepare(
          `INSERT INTO private_channel_withdrawals (
               id, organization_id, project_id, instance_id, wallet_id,
               owner, destination, mint, amount, private_channel_user_id,
               gateway_url, chain_rpc_url, escrow_program_id, escrow_instance_addr
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *`
        )
        .bind(
          generatePrivateChannelWithdrawalId(),
          input.organizationId,
          input.projectId,
          input.instanceId,
          input.walletId,
          input.owner,
          input.destination,
          input.mint,
          input.amount,
          input.privateChannelUserId,
          input.gatewayUrl,
          input.chainRpcUrl,
          input.escrowProgramId,
          input.escrowInstanceAddr
        )
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async updateWithdrawal(input: UpdateWithdrawalInput) {
      // COALESCE keeps the existing burn/release signature + failure_reason when the
      // transition doesn't supply them. The optional `expectedStatus` adds a
      // compare-and-swap guard so a concurrent worker can't regress/overwrite state
      // (returns null when the row already moved on).
      const row = await db
        .prepare(
          `UPDATE private_channel_withdrawals
              SET status = ?,
                  burn_signature = COALESCE(?, burn_signature),
                  release_signature = COALESCE(?, release_signature),
                  failure_reason = COALESCE(?, failure_reason),
                  updated_at = sdp_iso_now()
            WHERE id = ?
              AND (?::text IS NULL OR status = ?)
          RETURNING *`
        )
        .bind(
          input.status,
          input.burnSignature ?? null,
          input.releaseSignature ?? null,
          input.failureReason ?? null,
          input.id,
          input.expectedStatus ?? null,
          input.expectedStatus ?? null
        )
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async getWithdrawalById(scope: WithdrawalProjectScope & { id: string }) {
      const row = await db
        .prepare(
          `SELECT * FROM private_channel_withdrawals
             WHERE organization_id = ? AND project_id = ? AND id = ?`
        )
        .bind(scope.organizationId, scope.projectId, scope.id)
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async listWithdrawalsByProject(scope: WithdrawalProjectScope) {
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_withdrawals
             WHERE organization_id = ? AND project_id = ?
             ORDER BY created_at DESC, id DESC`
        )
        .bind(scope.organizationId, scope.projectId)
        .all<Record<string, unknown>>();
      return result.results.map(mapRow);
    },

    async listWithdrawalsByStatus(input: ListWithdrawalsByStatusInput) {
      if (input.statuses.length === 0) {
        return [];
      }
      const placeholders = input.statuses.map(() => "?").join(", ");
      const result = await db
        .prepare(
          // Tie-broken because of the LIMIT: this is the reconciler's work queue, so
          // rows sharing an updated_at at the cutoff would otherwise be included or
          // dropped arbitrarily from tick to tick, and one could be starved.
          `SELECT * FROM private_channel_withdrawals
             WHERE status IN (${placeholders})
             ORDER BY updated_at ASC, id ASC
             LIMIT ?`
        )
        .bind(...input.statuses, input.limit)
        .all<Record<string, unknown>>();
      return result.results.map(mapRow);
    },

    async countNonTerminalByInstance(instanceId: string) {
      const row = await db
        .prepare(
          `SELECT COUNT(*)::int AS count FROM private_channel_withdrawals
             WHERE instance_id = ?
               AND status IN ('pending', 'submitted', 'burn_confirmed', 'release_pending')`
        )
        .bind(instanceId)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
  };
}
