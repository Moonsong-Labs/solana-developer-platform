// Private Channels — "wallets" domain module (verify/delete write path).
//
// Empty scaffold. The read path already lives in
// routes/private-channels/handlers/wallets.ts (GET /wallets → listByProject).
// The write path — verifying a wallet against the connected SPC instance and
// revoking it — belongs here, mirroring the plain async-function style of
// ./service.ts.
//
// Prereq: add an SPC auth client to packages/sdp-private-channels/src/ (login +
// challenge-wallet + verify-wallet + delete-wallet) and export it from that
// package's index.ts — none exists on this branch yet. SPC auth contract:
//   POST   /auth/login
//   POST   /auth/challenge-wallet
//   POST   /auth/verify-wallet
//   DELETE /auth/wallets/{pubkey}
// (all JWT-gated; see ../solana-private-channels/auth/src/lib.rs).
//
// TODO: challengeWallet(...) — log into SPC for the project's SPC user (JWT),
//   call POST /auth/challenge-wallet, and return the message/nonce/expiry for the
//   client to sign with the selected wallet.
//
// TODO: verifyWallet(...) — call POST /auth/verify-wallet with the selected
//   wallet's pubkey + signature. ONLY on a successful SPC response, upsert() a row
//   into private_channel_verified_wallets (via
//   createPrivateChannelVerifiedWalletRepository). This module is the single
//   writer of that table.
//
// TODO: deleteWallet(...) — call DELETE /auth/wallets/{pubkey}. ONLY on a
//   successful SPC response, delete the matching row from
//   private_channel_verified_wallets (needs a new repo method, e.g.
//   deleteByScopeAndPubkey — see private-channel-verified-wallet.repository.ts).
//
// TODO: expose these via HTTP — add POST challenge, POST verify, and DELETE
//   handlers in routes/private-channels/handlers/wallets.ts, register the routes
//   in routes/private-channels/index.ts (the /wallets block), and add a
//   service/repo accessor in routes/private-channels/context.ts for consistency.

export {};
