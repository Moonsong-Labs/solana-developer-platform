// SPC auth service client. Two calls used today: /auth/register (issued per
// invited SDP user) and /auth/login (kept for future operate-on-behalf use).

import { PrivateChannelError, badRequest } from "./errors";
import { parseHttpUrl } from "./url";

const REQUEST_TIMEOUT_MS = 5000;

export interface SpcRegisterInput {
  username: string;
  password: string;
}

export interface SpcRegisteredUser {
  id: string;
  username: string;
  role: "user" | "operator";
  createdAt: string;
}

export interface SpcLoginInput {
  username: string;
  password: string;
}

export interface SpcLoginResult {
  token: string;
}

async function postJson<T>(authUrl: string, path: string, body: unknown): Promise<T> {
  const parsed = parseHttpUrl(authUrl, "Auth URL");
  if ("error" in parsed) throw badRequest(parsed.error);
  const base = `${parsed.url.protocol}//${parsed.url.host}${parsed.url.pathname.replace(/\/$/, "")}`;

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsedBody: unknown;
  try {
    parsedBody = text ? JSON.parse(text) : {};
  } catch {
    parsedBody = text;
  }

  if (res.ok) return parsedBody as T;

  const message = extractMessage(parsedBody) ?? `HTTP ${res.status}`;
  if (res.status === 409) throw new PrivateChannelError("CONFLICT", message);
  if (res.status === 400 || res.status === 422) {
    throw new PrivateChannelError("BAD_REQUEST", message);
  }
  throw new PrivateChannelError("INTERNAL_ERROR", message);
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
    const e = (body as Record<string, unknown>).error;
    if (typeof e === "string") return e;
  }
  return null;
}

// POST /auth/register — creates an SPC user. Returns the SPC user id + username.
export async function spcRegister(
  authUrl: string,
  input: SpcRegisterInput
): Promise<SpcRegisteredUser> {
  const raw = await postJson<{ id: string; username: string; role: string; created_at: string }>(
    authUrl,
    "/auth/register",
    input
  );
  return {
    id: raw.id,
    username: raw.username,
    role: raw.role === "operator" ? "operator" : "user",
    createdAt: raw.created_at,
  };
}

// POST /auth/login — exchanges username + password for a JWT. Not called by the
// invite flow; scaffolded for future operate-on-behalf-of use.
export async function spcLogin(authUrl: string, input: SpcLoginInput): Promise<SpcLoginResult> {
  return postJson<SpcLoginResult>(authUrl, "/auth/login", input);
}
