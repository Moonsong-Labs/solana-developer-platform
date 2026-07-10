/**
 * `@sdp/spc` — Solana Private Channels client.
 *
 * This barrel re-exports ONLY the Worker-safe surface. The remaining pathways
 * (`auth`, `programs/*`, `deposit`, `withdraw`, `reconcile`, `streamer`) — some
 * not yet implemented, some Node/DB-adjacent — are reachable through their
 * explicit subpaths only, so a gateway-only importer in the Cloudflare Worker
 * never inherits their deps.
 */

export * from "./balances";
export * from "./config";
export * from "./errors";
export * from "./gateway";
export * from "./transfer";
export * from "./types";
