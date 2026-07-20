export function generatePrivateChannelVerifiedWalletId(): string {
  return `pcvw_${crypto.randomUUID()}`;
}

/** A verified-wallet row: pubkey ↔ (project, SPC user), recorded after SPC verify-wallet. */
export interface PrivateChannelVerifiedWalletRow {
  id: string;
  organization_id: string;
  project_id: string;
  /** The private_channel_users row (SPC user) this wallet was verified under. */
  user_id: string;
  instance_id: string;
  wallet_id: string;
  pubkey: string;
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
  userId: string;
  instanceId: string;
  walletId: string;
  pubkey: string;
}

export interface PrivateChannelVerifiedWalletRepository {
  /**
   * Idempotently record a verified wallet. A re-verify of the same
   * (org, project, user_id, pubkey) refreshes the row. Call this ONLY from the
   * wallets domain module's verify logic (services/private-channels/wallets.ts) —
   * that flow is the single writer of private_channel_verified_wallets, after a
   * successful SPC verify.
   */
  upsert(input: UpsertVerifiedWalletInput): Promise<PrivateChannelVerifiedWalletRow>;
  /**
   * Remove a verified wallet after a successful SPC delete. Returns true if a
   * row was deleted. Single-writer contract as for upsert.
   */
  deleteByScopeAndPubkey(
    scope: VerifiedWalletScope,
    userId: string,
    pubkey: string
  ): Promise<boolean>;
  /** List a single user's verified wallets within a project scope, newest first. */
  listByProjectAndUser(
    scope: VerifiedWalletScope,
    userId: string
  ): Promise<PrivateChannelVerifiedWalletRow[]>;
}

export function mapPrivateChannelVerifiedWalletRow(
  row: Record<string, unknown>
): PrivateChannelVerifiedWalletRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    project_id: row.project_id as string,
    user_id: row.user_id as string,
    instance_id: row.instance_id as string,
    wallet_id: row.wallet_id as string,
    pubkey: row.pubkey as string,
    verified_at: row.verified_at as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
