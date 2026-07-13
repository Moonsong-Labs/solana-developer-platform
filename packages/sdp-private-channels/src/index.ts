/**
 * `@sdp/private-channels` — Solana Private Channels client.
 *
 * Public surface: config, errors, gateway, balances, transfer, health, and the
 * engine types. Deferred pathways (auth, escrow deposit/withdraw, reconciliation,
 * streamer) land with the slices that implement them.
 */

export * from "./balances";
export * from "./config";
export * from "./errors";
export * from "./gateway";
export * from "./health";
export * from "./transfer";
export * from "./types";
