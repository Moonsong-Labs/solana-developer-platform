/**
 * Shared REST transport for the private-channels client.
 *
 * The single fetch+parse primitive used by the gateway health probe
 * (`health.ts`) — modeled on `providerFetch`
 * (`packages/sdp-payments/src/ramps/fetch.ts`) but kept local so the package has
 * no cross-package dependency.
 */

/** Outcome of a REST request: the status plus raw text and best-effort JSON. */
export interface RestResult {
  /** HTTP status code. */
  status: number;
  /** True when the status is 2xx. */
  ok: boolean;
  /** The raw response text. */
  raw: string;
  /** Parsed JSON, or `undefined` when the body is empty or not JSON. */
  parsed: unknown;
}

/** Options for {@link restRequest}. `timeoutMs` is required — no unbounded requests. */
export interface RestRequestInit {
  /** HTTP method; defaults to `GET`. */
  method?: string;
  headers?: Record<string, string>;
  /** Pre-serialized request body. */
  body?: string;
  /** Per-request timeout, enforced via `AbortSignal.timeout`. */
  timeoutMs: number;
  /** Passed through to `fetch` (e.g. `"manual"` as an SSRF guard). */
  redirect?: RequestInit["redirect"];
  /** Injectable `fetch` for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

/**
 * Issue one HTTP request and read the body as raw text + best-effort JSON.
 * Throws on network failure or timeout (the `fetch` rejection propagates) — the
 * caller decides how to surface that (`unreachable` for the probe,
 * `AUTH_UNAVAILABLE` for the auth client).
 */
export async function restRequest(url: string, init: RestRequestInit): Promise<RestResult> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: init.method ?? "GET",
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.redirect ? { redirect: init.redirect } : {}),
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    // Non-JSON body — callers fall back to `raw`.
  }
  return { status: response.status, ok: response.ok, raw, parsed };
}
