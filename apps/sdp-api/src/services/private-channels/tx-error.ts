/**
 * Extract a useful failure reason from a Solana RPC/broadcast error.
 *
 * `@solana/kit` wraps preflight failures as `SolanaError` where `.message` is a
 * generic wrapper, the real detail lives in `.context.logs` + `.cause`. Callers
 * only get one line to store in `failure_reason`, so we compose it here.
 */

interface SolanaErrorLike {
  message?: unknown;
  cause?: unknown;
  context?: { logs?: unknown; err?: unknown; [key: string]: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Deepest cause message — often the actual "custom program error 0x…". */
function deepestMessage(error: unknown): string | null {
  let current = error;
  let depth = 0;
  while (isRecord(current) && depth < 5) {
    const cause = (current as SolanaErrorLike).cause;
    if (cause && cause !== current) {
      current = cause;
      depth++;
      continue;
    }
    break;
  }
  if (isRecord(current) && typeof (current as SolanaErrorLike).message === "string") {
    return (current as SolanaErrorLike).message as string;
  }
  return null;
}

/**
 * Build a one-line failure reason: top-level message + deepest cause + last log
 * line. Returns `fallback` if `error` isn't an Error-like object.
 */
export function describeTxError(error: unknown, fallback: string): string {
  if (!isRecord(error)) {
    return fallback;
  }
  const parts: string[] = [];

  const top = typeof error.message === "string" ? error.message : null;
  if (top) parts.push(top);

  const cause = deepestMessage(error);
  if (cause && cause !== top) parts.push(cause);

  const logs = (error as SolanaErrorLike).context?.logs;
  if (Array.isArray(logs) && logs.length > 0) {
    const last = logs[logs.length - 1];
    if (typeof last === "string" && last.length > 0) parts.push(last);
  }

  const err = (error as SolanaErrorLike).context?.err;
  if (err !== undefined && err !== null) parts.push(stringify(err));

  const joined = parts.join(" | ").slice(0, 2000);
  return joined.length > 0 ? joined : fallback;
}
