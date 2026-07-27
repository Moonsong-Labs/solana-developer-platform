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
  /**
   * Member who created the intent, captured while the request was authenticated.
   * The reconciler authenticates its gateway reads as this member. Null only for a
   * row whose member was later revoked (FK is ON DELETE SET NULL).
   */
  private_channel_user_id: string | null;
  /** Recipient channel balance (base units) captured at intent time; internal. */
  baseline_credited: string;
  /** Instance config snapshotted at intent time — the reconciler's fixed context. */
  gateway_url: string;
  chain_rpc_url: string;
  escrow_program_id: string;
  escrow_instance_addr: string;
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
  /** Member creating the intent; taken from the request's SPC auth context. */
  privateChannelUserId: string;
  baselineCredited: string;
  /** Instance config snapshot (immutable reconciliation context). */
  gatewayUrl: string;
  chainRpcUrl: string;
  escrowProgramId: string;
  escrowInstanceAddr: string;
}

export interface UpdateDepositInput {
  id: string;
  status: PrivateChannelDepositStatus;
  /** Set on submit; ignored (kept) when omitted on later transitions. */
  signature?: string | null;
  /** Set on failure; ignored (kept) when omitted. */
  failureReason?: string | null;
  /**
   * Compare-and-swap guard: when set, the update only applies if the row is still
   * in this status. Prevents concurrent workers from regressing/overwriting state.
   */
  expectedStatus?: PrivateChannelDepositStatus;
}

export interface ListDepositsByStatusInput {
  statuses: PrivateChannelDepositStatus[];
  limit: number;
}

export interface DepositRecipientScope {
  instanceId: string;
  recipient: string;
  mint: string;
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
  /**
   * All deposits for one (instance, recipient, mint), any status, oldest first.
   * The reconciler needs the full group — including already-credited deposits — to
   * attribute a single channel-balance increase to exactly one deposit.
   */
  listDepositsForRecipient(scope: DepositRecipientScope): Promise<PrivateChannelDepositRow[]>;
  /** Count non-terminal (prepared/submitted/confirmed) deposits for an instance —
   * the delete guard: an instance can't be deleted while deposits are in flight. */
  countNonTerminalByInstance(instanceId: string): Promise<number>;
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
