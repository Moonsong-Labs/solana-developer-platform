import type { AppDb } from "@/db";
import {
  type CreateDepositInput,
  type DepositProjectScope,
  type DepositRecipientScope,
  generatePrivateChannelDepositId,
  type ListDepositsByStatusInput,
  type PrivateChannelDepositRepository,
  type PrivateChannelDepositRow,
  type UpdateDepositInput,
} from "./private-channel-deposit.repository";

function mapRow(row: Record<string, unknown>): PrivateChannelDepositRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    project_id: row.project_id as string,
    instance_id: row.instance_id as string,
    wallet_id: row.wallet_id as string,
    depositor: row.depositor as string,
    recipient: row.recipient as string,
    mint: row.mint as string,
    amount: row.amount as string,
    baseline_credited: row.baseline_credited as string,
    status: row.status as PrivateChannelDepositRow["status"],
    signature: (row.signature ?? null) as string | null,
    failure_reason: (row.failure_reason ?? null) as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createPostgresPrivateChannelDepositRepository(
  db: AppDb
): PrivateChannelDepositRepository {
  return {
    async createDeposit(input: CreateDepositInput) {
      const row = await db
        .prepare(
          `INSERT INTO private_channel_deposits (
               id, organization_id, project_id, instance_id, wallet_id,
               depositor, recipient, mint, amount, baseline_credited
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *`
        )
        .bind(
          generatePrivateChannelDepositId(),
          input.organizationId,
          input.projectId,
          input.instanceId,
          input.walletId,
          input.depositor,
          input.recipient,
          input.mint,
          input.amount,
          input.baselineCredited
        )
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async updateDeposit(input: UpdateDepositInput) {
      // COALESCE keeps the existing signature/failure_reason when the transition
      // doesn't supply them (e.g. confirmed->credited leaves the signature intact).
      const row = await db
        .prepare(
          `UPDATE private_channel_deposits
              SET status = ?,
                  signature = COALESCE(?, signature),
                  failure_reason = COALESCE(?, failure_reason),
                  updated_at = sdp_iso_now()
            WHERE id = ?
          RETURNING *`
        )
        .bind(input.status, input.signature ?? null, input.failureReason ?? null, input.id)
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async getDepositById(scope: DepositProjectScope & { id: string }) {
      const row = await db
        .prepare(
          `SELECT * FROM private_channel_deposits
             WHERE organization_id = ? AND project_id = ? AND id = ?`
        )
        .bind(scope.organizationId, scope.projectId, scope.id)
        .first<Record<string, unknown>>();
      return row ? mapRow(row) : null;
    },

    async listDepositsByProject(scope: DepositProjectScope) {
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_deposits
             WHERE organization_id = ? AND project_id = ?
             ORDER BY created_at DESC`
        )
        .bind(scope.organizationId, scope.projectId)
        .all<Record<string, unknown>>();
      return result.results.map(mapRow);
    },

    async listDepositsByStatus(input: ListDepositsByStatusInput) {
      if (input.statuses.length === 0) {
        return [];
      }
      const placeholders = input.statuses.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_deposits
             WHERE status IN (${placeholders})
             ORDER BY updated_at ASC
             LIMIT ?`
        )
        .bind(...input.statuses, input.limit)
        .all<Record<string, unknown>>();
      return result.results.map(mapRow);
    },

    async listDepositsForRecipient(scope: DepositRecipientScope) {
      const result = await db
        .prepare(
          `SELECT * FROM private_channel_deposits
             WHERE instance_id = ? AND recipient = ? AND mint = ?
             ORDER BY created_at ASC`
        )
        .bind(scope.instanceId, scope.recipient, scope.mint)
        .all<Record<string, unknown>>();
      return result.results.map(mapRow);
    },
  };
}
