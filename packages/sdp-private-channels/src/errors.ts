/**
 * SPC client errors.
 *
 * Mirrors the `SdpPaymentsError` shape (`packages/sdp-payments/src/errors.ts`)
 * so the sdp-api adapter can map `PrivateChannelError.code` → `AppError` in one place. The
 * library throws only `PrivateChannelError`; it never reaches for the app's `AppError`.
 */

/** Machine-readable error classifications, each mapped to an HTTP status below. */
export type PrivateChannelErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "GATEWAY_UNAVAILABLE"
  | "INTERNAL_ERROR";

const ERROR_STATUS_CODES: Record<PrivateChannelErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  GATEWAY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const DEFAULT_ERROR_MESSAGES: Record<PrivateChannelErrorCode, string> = {
  BAD_REQUEST: "Invalid request",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Access denied",
  CONFLICT: "Resource already exists",
  RATE_LIMITED: "Too many requests",
  NOT_FOUND: "Resource not found",
  GATEWAY_UNAVAILABLE: "The private channel gateway is temporarily unavailable",
  INTERNAL_ERROR: "An internal error occurred",
};

/** The single error type the SPC client throws; the adapter maps `code` → `AppError`. */
export class PrivateChannelError extends Error {
  /** HTTP status derived from `code` (`ERROR_STATUS_CODES`). */
  public readonly statusCode: number;

  constructor(
    /** Machine-readable classification. */
    public readonly code: PrivateChannelErrorCode,
    /** Human-readable message; defaults to `DEFAULT_ERROR_MESSAGES[code]`. */
    message?: string,
    /** Optional structured context (e.g. `{ cause, status }`). */
    public readonly details?: Record<string, unknown>
  ) {
    super(message || DEFAULT_ERROR_MESSAGES[code]);
    this.name = "PrivateChannelError";
    this.statusCode = ERROR_STATUS_CODES[code];
  }
}

/** Build a `BAD_REQUEST` (400) error. */
export function badRequest(
  message?: string,
  details?: Record<string, unknown>
): PrivateChannelError {
  return new PrivateChannelError("BAD_REQUEST", message, details);
}

/** Build a `GATEWAY_UNAVAILABLE` (503) error — the JSON-RPC gateway is unreachable. */
export function gatewayUnavailable(
  message?: string,
  details?: Record<string, unknown>
): PrivateChannelError {
  return new PrivateChannelError("GATEWAY_UNAVAILABLE", message, details);
}
