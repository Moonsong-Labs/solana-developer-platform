/**
 * SPC client errors.
 *
 * Mirrors the `SdpPaymentsError` shape (`packages/sdp-payments/src/errors.ts`)
 * so the sdp-api adapter can map `PrivateChannelError.code` → `AppError` in one
 * place. The library throws only `PrivateChannelError`; it never reaches for the
 * app's `AppError`.
 */

/** Machine-readable error classifications, each mapped to an HTTP status below. */
export type PrivateChannelErrorCode = "BAD_REQUEST" | "INTERNAL_ERROR";

const ERROR_STATUS_CODES: Record<PrivateChannelErrorCode, number> = {
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
};

const DEFAULT_ERROR_MESSAGES: Record<PrivateChannelErrorCode, string> = {
  BAD_REQUEST: "Invalid request",
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
