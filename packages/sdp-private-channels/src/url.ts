/**
 * Shared URL validation for the private-channels client.
 *
 * Both the config resolver (`config.ts`, which throws on bad env) and the
 * gateway health probe (`health.ts`, which never throws) need the same rule: a
 * trimmed, parseable `http(s)` URL. This is the single source for that rule, so
 * the two callers stop reimplementing it in divergent ways.
 */

import { badRequest } from "./errors";

/**
 * Parse + validate a trimmed `http(s)` URL. Returns the parsed `URL` or a
 * human-readable `error` message. The messages match what `health.ts` has
 * always surfaced (`required` / `Invalid URL` / `Unsupported protocol`).
 */
function parseHttpUrl(input: string): { url: URL } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "Gateway URL is required." };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: `Invalid URL: ${trimmed}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `Unsupported protocol: ${url.protocol}` };
  }
  return { url };
}

/**
 * Normalize an `http(s)` URL to its base `${protocol}//${host}${path}` with any
 * trailing slash stripped. Never throws — returns `{ error }` for the caller
 * (the health probe) to surface as an `unreachable` result.
 */
export function normalizeHttpBase(input: string): { base: string } | { error: string } {
  const parsed = parseHttpUrl(input);
  if ("error" in parsed) {
    return parsed;
  }
  const { url } = parsed;
  return { base: `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}` };
}

/** Assert `value` is a valid `http(s)` URL, throwing `BAD_REQUEST` naming `field`. */
export function assertHttpUrl(value: string, field: string): string {
  if ("error" in parseHttpUrl(value)) {
    throw badRequest(`Invalid URL for ${field}: ${value}`);
  }
  return value;
}
