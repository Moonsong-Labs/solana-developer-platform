import { HeliusRingsError } from "@sdp/helius-rings";
import { getDb } from "@/db";
import { isRingsInsecureHttpAllowed } from "@/lib/feature-flags";
import {
  type CredentialSecretPayload,
  createCredentialSecretStore,
} from "@/services/credential-secret-store";
import {
  HeliusRingsConnectionStore,
  type ResolvableHeliusRingsConnectionRow,
} from "@/services/stores/helius-rings-connection.store";
import type { Env } from "@/types/env";

export interface ResolvedRingsConnection {
  id: string | null;
  name: string;
  source: "database" | "legacy_environment";
  solanaRpcUrl: string;
  indexerUrl: string;
  proverUrl: string;
  ringRpcUrl?: string;
  allowInsecureHttp: boolean;
}

export async function resolveRingsConnection(input: {
  env: Env;
  organizationId: string;
  projectId: string;
  connectionId?: string | null;
}): Promise<ResolvedRingsConnection> {
  const store = new HeliusRingsConnectionStore(getDb(input.env));
  const row = input.connectionId
    ? await store.findById(input.organizationId, input.projectId, input.connectionId)
    : await store.findDefault(input.organizationId, input.projectId);

  if (row) return resolveStored(input.env, row);
  if (!input.connectionId) {
    const legacy = resolveLegacy(input.env);
    if (legacy) return legacy;
  }

  throw new HeliusRingsError(
    "config_error",
    input.connectionId
      ? "Helius Rings connection is missing, inactive, or belongs to another project"
      : "Helius Rings setup is required for this project"
  );
}

async function resolveStored(
  env: Env,
  row: ResolvableHeliusRingsConnectionRow
): Promise<ResolvedRingsConnection> {
  const secretStore = createCredentialSecretStore(env, row.credential_storage_backend);
  const payload = await secretStore.read({
    orgId: row.organization_id,
    stored: {
      storageBackend: row.credential_storage_backend,
      secretRef: row.credential_secret_ref ?? undefined,
      secretVersionRef: row.credential_secret_version_ref ?? undefined,
      encryptedSecretPayload: row.credential_encrypted_secret_payload ?? undefined,
    },
  });
  const endpoints = parsePayload(payload);
  return {
    id: row.id,
    name: row.name,
    source: "database",
    ...endpoints,
    // A database copied from a development environment must not carry its
    // plaintext exception into a deployed runtime.
    allowInsecureHttp: row.allow_insecure_http && env.ENVIRONMENT === "development",
  };
}

function parsePayload(
  payload: CredentialSecretPayload
): Omit<ResolvedRingsConnection, "id" | "name" | "source" | "allowInsecureHttp"> {
  const solanaRpcUrl = requiredString(payload.solanaRpcUrl, "solanaRpcUrl");
  const indexerUrl = requiredString(payload.indexerUrl, "indexerUrl");
  const proverUrl = requiredString(payload.proverUrl, "proverUrl");
  const ringRpcUrl = optionalString(payload.ringRpcUrl);
  return { solanaRpcUrl, indexerUrl, proverUrl, ...(ringRpcUrl ? { ringRpcUrl } : {}) };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HeliusRingsError("config_error", `Helius Rings credential is missing ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function resolveLegacy(env: Env): ResolvedRingsConnection | null {
  const solanaRpcUrl = env.HELIUS_RINGS_RPC_URL?.trim();
  const indexerUrl = env.HELIUS_RINGS_INDEXER_URL?.trim();
  const proverUrl = env.HELIUS_RINGS_PROVER_URL?.trim();
  if (!solanaRpcUrl || !indexerUrl || !proverUrl) return null;
  const ringRpcUrl = env.HELIUS_RINGS_RING_RPC_URL?.trim();
  return {
    id: null,
    name: "Legacy environment configuration",
    source: "legacy_environment",
    solanaRpcUrl,
    indexerUrl,
    proverUrl,
    ...(ringRpcUrl ? { ringRpcUrl } : {}),
    allowInsecureHttp: isRingsInsecureHttpAllowed(env),
  };
}

/**
 * Resolve one devnet RPC for chain-wide background reads. All Rings
 * connections are constrained to devnet, so block height does not depend on
 * which project's default connection supplies it.
 */
export async function resolveRingsBackgroundRpcUrl(env: Env): Promise<string | undefined> {
  const tenant = await getDb(env).queryOne<{ organization_id: string; project_id: string }>(
    `SELECT c.organization_id, c.project_id
       FROM helius_rings_connections c
       JOIN provider_credentials pc ON pc.id = c.provider_credential_id
      WHERE c.status = 'active' AND c.is_default = TRUE AND pc.status = 'active'
      ORDER BY c.created_at ASC
      LIMIT 1`
  );
  if (tenant) {
    return (
      await resolveRingsConnection({
        env,
        organizationId: tenant.organization_id,
        projectId: tenant.project_id,
      })
    ).solanaRpcUrl;
  }
  return resolveLegacy(env)?.solanaRpcUrl;
}
