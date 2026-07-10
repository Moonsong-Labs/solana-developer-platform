/**
 * SPC client errors.
 *
 * Mirrors the `SdpPaymentsError` shape (`packages/sdp-payments/src/errors.ts`)
 * so the sdp-api adapter can map `SpcError.code` → `AppError` in one place. The
 * library throws only `SpcError`; it never reaches for the app's `AppError`.
 */

/** Machine-readable error classifications, each mapped to an HTTP status below. */
export type SpcErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "GATEWAY_UNAVAILABLE"
  | "AUTH_UNAVAILABLE"
  | "METHOD_NOT_SUPPORTED"
  | "INTERNAL_ERROR";

const ERROR_STATUS_CODES: Record<SpcErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  GATEWAY_UNAVAILABLE: 503,
  AUTH_UNAVAILABLE: 503,
  METHOD_NOT_SUPPORTED: 501,
  INTERNAL_ERROR: 500,
};

const DEFAULT_ERROR_MESSAGES: Record<SpcErrorCode, string> = {
  BAD_REQUEST: "Invalid request",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Access denied",
  CONFLICT: "Resource already exists",
  RATE_LIMITED: "Too many requests",
  NOT_FOUND: "Resource not found",
  GATEWAY_UNAVAILABLE: "The private channel gateway is temporarily unavailable",
  AUTH_UNAVAILABLE: "The private channel auth service is temporarily unavailable",
  METHOD_NOT_SUPPORTED: "This private channel pathway is not implemented yet",
  INTERNAL_ERROR: "An internal error occurred",
};

/** The single error type the SPC client throws; the adapter maps `code` → `AppError`. */
export class SpcError extends Error {
  /** HTTP status derived from `code` (`ERROR_STATUS_CODES`). */
  public readonly statusCode: number;

  constructor(
    /** Machine-readable classification. */
    public readonly code: SpcErrorCode,
    /** Human-readable message; defaults to `DEFAULT_ERROR_MESSAGES[code]`. */
    message?: string,
    /** Optional structured context (e.g. `{ cause, status }`). */
    public readonly details?: Record<string, unknown>
  ) {
    super(message || DEFAULT_ERROR_MESSAGES[code]);
    this.name = "SpcError";
    this.statusCode = ERROR_STATUS_CODES[code];
  }
}

/** Build a `BAD_REQUEST` (400) error. */
export function badRequest(message?: string, details?: Record<string, unknown>): SpcError {
  return new SpcError("BAD_REQUEST", message, details);
}

/** Build a `GATEWAY_UNAVAILABLE` (503) error — the JSON-RPC gateway is unreachable. */
export function gatewayUnavailable(message?: string, details?: Record<string, unknown>): SpcError {
  return new SpcError("GATEWAY_UNAVAILABLE", message, details);
}

/** Build an `AUTH_UNAVAILABLE` (503) error — the auth service is unreachable. */
export function authUnavailable(message?: string, details?: Record<string, unknown>): SpcError {
  return new SpcError("AUTH_UNAVAILABLE", message, details);
}

/** Build a `METHOD_NOT_SUPPORTED` (501) error — a deferred pathway was called. */
export function methodNotSupported(message?: string): SpcError {
  return new SpcError("METHOD_NOT_SUPPORTED", message);
}

/** Classify an HTTP status from the auth service into an `SpcError` code. */
export function classifyAuthStatus(status: number): SpcErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "AUTH_UNAVAILABLE";
  return "BAD_REQUEST";
}
