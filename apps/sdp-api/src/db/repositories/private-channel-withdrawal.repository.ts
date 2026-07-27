import type { PrivateChannelWithdrawal, PrivateChannelWithdrawalStatus } from "@sdp/types";
import type { RepositoryDbClient } from "./base";

export function generatePrivateChannelWithdrawalId(): string {
  return `wd_${crypto.randomUUID()}`;
}

export interface PrivateChannelWithdrawalRow {
  id: string;
  organization_id: string;
  project_id: string;
  instance_id: string;
  wallet_id: string;
  owner: string;
  destination: string;
  mint: string;
  amount: string;
  /**
   * Member who created the intent, captured while the request was authenticated.
   * The reconciler authenticates its gateway reads as this member. Null only for a
   * row whose member was later revoked (FK is ON DELETE SET NULL).
   */
  private_channel_user_id: string | null;
  /** Instance config snapshotted at intent time — the reconciler's fixed context. */
  gateway_url: string;
  chain_rpc_url: string;
  escrow_program_id: string;
  escrow_instance_addr: string;
  status: PrivateChannelWithdrawalStatus;
  /** Channel-chain burn signature (null until submitted). */
  burn_signature: string | null;
  /** Devnet release signature = settlement correlation (null until released). */
  release_signature: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WithdrawalProjectScope {
  organizationId: string;
  projectId: string;
}

export interface CreateWithdrawalInput extends WithdrawalProjectScope {
  instanceId: string;
  walletId: string;
  owner: string;
  destination: string;
  mint: string;
  amount: string;
  /** Member creating the intent; taken from the request's SPC auth context. */
  privateChannelUserId: string;
  /** Instance config snapshot (immutable reconciliation context). */
  gatewayUrl: string;
  chainRpcUrl: string;
  escrowProgramId: string;
  escrowInstanceAddr: string;
}

export interface UpdateWithdrawalInput {
  id: string;
  status: PrivateChannelWithdrawalStatus;
  /** Set on submit; ignored (kept) when omitted on later transitions. */
  burnSignature?: string | null;
  /** Set on release; ignored (kept) when omitted. */
  releaseSignature?: string | null;
  /** Set on failure; ignored (kept) when omitted. */
  failureReason?: string | null;
  /**
   * Compare-and-swap guard: when set, the update only applies if the row is still
   * in this status. Prevents concurrent workers from regressing/overwriting state.
   */
  expectedStatus?: PrivateChannelWithdrawalStatus;
}

export interface ListWithdrawalsByStatusInput {
  statuses: PrivateChannelWithdrawalStatus[];
  limit: number;
}

export interface PrivateChannelWithdrawalRepositoryContext {
  db: RepositoryDbClient;
}

export interface PrivateChannelWithdrawalRepository {
  createWithdrawal(input: CreateWithdrawalInput): Promise<PrivateChannelWithdrawalRow | null>;
  updateWithdrawal(input: UpdateWithdrawalInput): Promise<PrivateChannelWithdrawalRow | null>;
  getWithdrawalById(
    scope: WithdrawalProjectScope & { id: string }
  ): Promise<PrivateChannelWithdrawalRow | null>;
  listWithdrawalsByProject(scope: WithdrawalProjectScope): Promise<PrivateChannelWithdrawalRow[]>;
  /** Reconciler scan across projects — non-terminal withdrawals only. */
  listWithdrawalsByStatus(
    input: ListWithdrawalsByStatusInput
  ): Promise<PrivateChannelWithdrawalRow[]>;
  /** Count non-terminal withdrawals for an instance — the delete guard: an instance
   * can't be deleted while withdrawals are in flight. */
  countNonTerminalByInstance(instanceId: string): Promise<number>;
}

export function mapPrivateChannelWithdrawalRow(
  row: PrivateChannelWithdrawalRow
): PrivateChannelWithdrawal {
  return {
    id: row.id,
    instanceId: row.instance_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    walletId: row.wallet_id,
    owner: row.owner,
    destination: row.destination,
    mint: row.mint,
    amount: row.amount,
    status: row.status,
    burnSignature: row.burn_signature ?? null,
    releaseSignature: row.release_signature ?? null,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
