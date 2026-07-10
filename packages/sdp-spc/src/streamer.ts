/**
 * Streamer `/ws` firehose.
 *
 * The streamer is bound to the internal network and SDP does not consume it
 * today. ⚠️ It emits each tx once at insert and does NOT re-broadcast the
 * settlement transition, so it must never back a "did it settle" decision (use
 * reconciliation). Typed here; a live client is not implemented (only if a need
 * arises).
 */

import { methodNotSupported } from "./errors";
import type { StreamerEvent } from "./types";

export type { StreamerEvent } from "./types";

/** Handle for a live streamer connection. */
export interface StreamerHandle {
  /** Close the WebSocket and stop delivering events. */
  close(): void;
}

/**
 * Open the `/ws` firehose and invoke `onEvent` per frame. NOT IMPLEMENTED — throws.
 *
 * @param _wsUrl Streamer WebSocket URL (`:8902`, internal network only).
 * @param _onEvent Callback invoked with each {@link StreamerEvent}.
 */
export function connectStreamer(
  _wsUrl: string,
  _onEvent: (event: StreamerEvent) => void
): StreamerHandle {
  throw methodNotSupported("The SPC streamer is internal-only and not consumed by SDP yet.");
}
