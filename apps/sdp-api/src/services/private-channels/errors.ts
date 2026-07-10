import { SpcError, type SpcErrorCode } from "@sdp/spc";
import { AppError, type ErrorCode } from "@/lib/errors";

const SPC_TO_APP_ERROR: Record<SpcErrorCode, ErrorCode> = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  GATEWAY_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  AUTH_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  METHOD_NOT_SUPPORTED: "BAD_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

/**
 * Map an `SpcError` (thrown by `@sdp/spc`) to the app's `AppError`. Called in
 * the private-channels handler catch so `app.ts` `onError` need not learn about
 * `SpcError`.
 */
export function mapSpcError(error: unknown): AppError {
  if (error instanceof SpcError) {
    return new AppError(SPC_TO_APP_ERROR[error.code], error.message, {
      ...(error.details ?? {}),
      provider: "private-channels",
    });
  }
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Private channel request failed"
  );
}
