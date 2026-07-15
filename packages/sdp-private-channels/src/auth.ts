/**
 * SPC auth service (`:8903`) REST client.
 *
 * Typed request/response, `AbortSignal.timeout`, `{error}` envelope parsing, and
 * HTTP-status → `PrivateChannelError` classification. `fetchImpl` is injectable
 * for tests. Worker-safe (fetch only; no Node/DB imports) — reachable through the
 * `@sdp/private-channels/auth` subpath, not the package barrel.
 *
 * Wire shapes verified against SPC source (`auth/src/models.rs`,
 * `auth/src/routes/*`): register → `User`, login → `{token}`, challenge-wallet →
 * `{message,nonce,expires_at}`, verify-wallet `{pubkey,nonce,signature}` →
 * `{pubkey,created_at}`. `role` and the signature encoding (base58) match SPC.
 */

import { badRequest, classifyAuthStatus, PrivateChannelError } from "./errors";

const DEFAULT_TIMEOUT_MS = 15_000;

/** SPC user roles (serialized lowercase by the auth service). */
export type SpcUserRole = "operator" | "user";

/** `POST /auth/register` response — the created SPC user (password never returned). */
export interface SpcAuthUser {
  id: string;
  username: string;
  role: SpcUserRole;
  created_at: string;
}

/** `POST /auth/login` response — a 24h HS256 JWT (no refresh). */
export interface SpcAuthToken {
  token: string;
}

/** `POST /auth/challenge-wallet` response — the exact message to sign + its nonce. */
export interface SpcWalletChallenge {
  /** The exact UTF-8 string the wallet must sign. */
  message: string;
  /** Single-use nonce (UUID), echoed back on verify. */
  nonce: string;
  expires_at: string;
}

/** `POST /auth/verify-wallet` / `GET /auth/wallets` entry — a verified wallet. */
export interface SpcVerifiedWallet {
  pubkey: string;
  created_at: string;
}

/** Credentials for register/login (`{username, password}`). */
export interface RegisterInput {
  /** 5–32 chars, alphanumeric + `_`/`-`, globally unique. */
  username: string;
  /** 6–128 chars (Argon2-hashed server-side). */
  password: string;
}

/** Body for `POST /auth/verify-wallet`. */
export interface VerifyWalletInput {
  /** Base58 wallet pubkey being verified. */
  pubkey: string;
  /** Nonce from the preceding challenge. */
  nonce: string;
  /** Base58 Ed25519 signature over the challenge message. */
  signature: string;
}

/** Auth-service liveness result (`GET /health`). */
export interface SpcAuthHealth {
  ok: boolean;
  status: number;
}

/** Construction options for {@link createAuthClient}. */
export interface SpcAuthClientOptions {
  /** Injectable `fetch` (for tests); defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms; defaults to `DEFAULT_TIMEOUT_MS` (15s). */
  timeoutMs?: number;
}

/** Typed REST client for the SPC auth service (`:8903`). */
export interface SpcAuthClient {
  /** `POST /auth/register` — create a proxy user (409 if the username is taken). */
  register(input: RegisterInput): Promise<SpcAuthUser>;
  /** `POST /auth/login` — exchange credentials for a 24h JWT (401 on bad creds). */
  login(input: RegisterInput): Promise<SpcAuthToken>;
  /** `POST /auth/challenge-wallet` — issue a wallet-verification challenge (JWT). */
  challengeWallet(token: string): Promise<SpcWalletChallenge>;
  /** `POST /auth/verify-wallet` — record a signed wallet (JWT; 409 if already verified). */
  verifyWallet(token: string, input: VerifyWalletInput): Promise<SpcVerifiedWallet>;
  /** `GET /auth/wallets` — list the caller's verified wallets (JWT). */
  listWallets(token: string): Promise<SpcVerifiedWallet[]>;
  /** `DELETE /auth/wallets/{pubkey}` — unlink a wallet (JWT; 400 if not associated). */
  deleteWallet(token: string, pubkey: string): Promise<void>;
  /** `GET /health` — auth-service liveness. */
  health(): Promise<SpcAuthHealth>;
}

/** Pull the `{ error }` message from a parsed auth response, when present. */
function extractErrorMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/**
 * Construct a typed {@link SpcAuthClient} for one instance's auth base URL (the
 * connected instance's `authUrl`, e.g. `http://auth.example:8903`). Requires a
 * non-empty base URL (calls throw `BAD_REQUEST` otherwise); each request maps
 * HTTP status → `PrivateChannelError` and enforces `timeoutMs`.
 */
export function createAuthClient(
  authBaseUrl: string,
  options: SpcAuthClientOptions = {}
): SpcAuthClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function baseUrl(): string {
    if (!authBaseUrl) {
      throw badRequest("The auth service URL is not set; the auth service is unavailable.");
    }
    return authBaseUrl;
  }

  async function call<T>(
    path: string,
    init: { method: string; token?: string; body?: unknown; expectNoContent?: boolean }
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (init.token) {
      headers.Authorization = `Bearer ${init.token}`;
    }

    // Resolve the URL (and validate the base) outside the try so a missing base
    // URL surfaces as BAD_REQUEST rather than being masked as AUTH_UNAVAILABLE.
    const url = new URL(path, baseUrl()).toString();

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new PrivateChannelError(
        "AUTH_UNAVAILABLE",
        `Failed to reach the auth service at ${path}`,
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }

    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      throw new PrivateChannelError(
        classifyAuthStatus(response.status),
        extractErrorMessage(parsed) ?? `Auth request to ${path} failed (${response.status})`,
        { status: response.status }
      );
    }

    if (init.expectNoContent) {
      return undefined as T;
    }
    return parsed as T;
  }

  return {
    register: (input) => call<SpcAuthUser>("/auth/register", { method: "POST", body: input }),
    login: (input) => call<SpcAuthToken>("/auth/login", { method: "POST", body: input }),
    challengeWallet: (token) =>
      call<SpcWalletChallenge>("/auth/challenge-wallet", { method: "POST", token }),
    verifyWallet: (token, input) =>
      call<SpcVerifiedWallet>("/auth/verify-wallet", { method: "POST", token, body: input }),
    listWallets: (token) => call<SpcVerifiedWallet[]>("/auth/wallets", { method: "GET", token }),
    deleteWallet: (token, pubkey) =>
      call<void>(`/auth/wallets/${encodeURIComponent(pubkey)}`, {
        method: "DELETE",
        token,
        expectNoContent: true,
      }),
    health: async () => {
      const response = await fetchImpl(new URL("/health", baseUrl()).toString(), {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: response.ok, status: response.status };
    },
  };
}
