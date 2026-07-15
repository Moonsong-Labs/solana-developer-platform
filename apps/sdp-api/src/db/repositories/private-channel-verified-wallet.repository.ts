import type { RepositoryDbClient } from "./base";

export function generatePrivateChannelVerifiedWalletId(): string {
  return `pcvw_${crypto.randomUUID()}`;
}

export type PrivateChannelVerifiedWalletStatus = "active" | "revoked";

/** A verified-wallet row: pubkey ↔ project scope, recorded after SPC verify-wallet. */
export interface PrivateChannelVerifiedWalletRow {
  id: string;
  organization_id: string;
  project_id: string;
  instance_id: string;
  wallet_id: string;
  pubkey: string;
  /** The derived SPC username the wallet was verified under. */
  spc_username: string;
  status: PrivateChannelVerifiedWalletStatus;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

/** Project tenancy scope for verified-wallet lookups. */
export interface VerifiedWalletScope {
  organizationId: string;
  projectId: string;
}

export interface UpsertVerifiedWalletInput extends VerifiedWalletScope {
  instanceId: string;
  walletId: string;
  pubkey: string;
  spcUsername: string;
}

export interface PrivateChannelVerifiedWalletRepositoryContext {
  db: RepositoryDbClient;
}

export interface PrivateChannelVerifiedWalletRepository {
  /** Fetch the verification row for a pubkey within a project scope, if any. */
  getByScopeAndPubkey(
    scope: VerifiedWalletScope,
    pubkey: string
  ): Promise<PrivateChannelVerifiedWalletRow | null>;
  /**
   * Idempotently record a verified wallet. A re-verify of the same
   * (org, project, pubkey) refreshes the row (and reactivates a revoked one).
   */
  upsert(input: UpsertVerifiedWalletInput): Promise<PrivateChannelVerifiedWalletRow>;
  /** List active verified wallets for a project scope, newest first. */
  listByProject(scope: VerifiedWalletScope): Promise<PrivateChannelVerifiedWalletRow[]>;
}

export function mapPrivateChannelVerifiedWalletRow(
  row: Record<string, unknown>
): PrivateChannelVerifiedWalletRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    project_id: row.project_id as string,
    instance_id: row.instance_id as string,
    wallet_id: row.wallet_id as string,
    pubkey: row.pubkey as string,
    spc_username: row.spc_username as string,
    status: row.status as PrivateChannelVerifiedWalletStatus,
    verified_at: row.verified_at as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
