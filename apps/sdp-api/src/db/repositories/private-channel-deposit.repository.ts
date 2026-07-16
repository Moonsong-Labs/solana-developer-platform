import type { PrivateChannelDeposit, PrivateChannelDepositStatus } from "@sdp/types";
import type { RepositoryDbClient } from "./base";

export function generatePrivateChannelDepositId(): string {
  return `dep_${crypto.randomUUID()}`;
}

export interface PrivateChannelDepositRow {
  id: string;
  organization_id: string;
  project_id: string;
  instance_id: string;
  wallet_id: string;
  depositor: string;
  recipient: string;
  mint: string;
  amount: string;
  /** Recipient channel balance (base units) captured at intent time; internal. */
  baseline_credited: string;
  status: PrivateChannelDepositStatus;
  signature: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepositProjectScope {
  organizationId: string;
  projectId: string;
}

export interface CreateDepositInput extends DepositProjectScope {
  instanceId: string;
  walletId: string;
  depositor: string;
  recipient: string;
  mint: string;
  amount: string;
  baselineCredited: string;
}

export interface UpdateDepositInput {
  id: string;
  status: PrivateChannelDepositStatus;
  /** Set on submit; ignored (kept) when omitted on later transitions. */
  signature?: string | null;
  /** Set on failure; ignored (kept) when omitted. */
  failureReason?: string | null;
}

export interface ListDepositsByStatusInput {
  statuses: PrivateChannelDepositStatus[];
  limit: number;
}

export interface PrivateChannelDepositRepositoryContext {
  db: RepositoryDbClient;
}

export interface PrivateChannelDepositRepository {
  createDeposit(input: CreateDepositInput): Promise<PrivateChannelDepositRow | null>;
  updateDeposit(input: UpdateDepositInput): Promise<PrivateChannelDepositRow | null>;
  getDepositById(
    scope: DepositProjectScope & { id: string }
  ): Promise<PrivateChannelDepositRow | null>;
  listDepositsByProject(scope: DepositProjectScope): Promise<PrivateChannelDepositRow[]>;
  /** Reconciler scan across projects — non-terminal deposits only. */
  listDepositsByStatus(input: ListDepositsByStatusInput): Promise<PrivateChannelDepositRow[]>;
}

export function mapPrivateChannelDepositRow(row: PrivateChannelDepositRow): PrivateChannelDeposit {
  return {
    id: row.id,
    instanceId: row.instance_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    walletId: row.wallet_id,
    depositor: row.depositor,
    recipient: row.recipient,
    mint: row.mint,
    amount: row.amount,
    status: row.status,
    signature: row.signature ?? null,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
