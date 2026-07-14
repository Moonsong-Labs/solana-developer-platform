/**
 * `@sdp/private-channels` — Solana Private Channels client.
 *
 * Public surface: config, errors, health, and the engine types. Deferred
 * pathways (JSON-RPC gateway client, balances, transfers, auth, escrow
 * deposit/withdraw, reconciliation, streamer) land with the slices that
 * implement them.
 */

export * from "./config";
export * from "./errors";
export * from "./health";
export * from "./types";
