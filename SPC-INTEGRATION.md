# Solana Private Channels (SPC) — Integration Reference for SDP

> Status: confirmed against SPC source (`~/opt/solana-private-channels`, solana-foundation) on 2026‑07‑09 via a source dive, cross‑checked with the SPC docs and the SDP grant proposal (`private-channels-grant-proposal.pdf`, draft 2026‑06‑24).
> Scope: everything SDP needs to integrate SPC into the Payments surface for the 4‑week sandbox MVP.

This document is the single source of truth for **what SPC actually exposes**, **how to call it**, and **which pieces of the grant are SPC‑backed vs. greenfield SDP work**. Where the SPC README/docs disagree with the code, the code wins and is noted.

---

## 1. Mental model (read this first)

SPC is **not a REST product**. It is a **Solana‑RPC‑compatible private payment channel**: its own SVM ledger, account state in Postgres/Redis, ~100 ms instant finality, gasless. Everything money‑related is an ordinary **Ed25519‑signed Solana transaction**, submitted through a Solana‑shaped JSON‑RPC gateway. "Private" means access‑controlled reads + off‑mainnet batching — **not** encrypted/ZK state (channel balances are plaintext in Postgres).

Consequences that shape the whole integration:

- **The client signs everything.** Deposits, internal transfers, and withdrawals are all signed by the acting wallet. SPC never signs a user's transfer. → *The member's own wallet is the signer* (browser/client‑side), which matches the grant's "authorized wallet" model.
- **JWT is for reads, signatures are for writes.** A JWT gates *read* RPC methods (RBAC); it never authorizes a transfer. The two are orthogonal.
- **SPC has no "channel" or "membership" concept.** Logical channels (Treasury Ops, Team Payroll), roles, and join policy are **100% SDP‑native**. SPC contributes only global auth + wallet verification + the ledger.
- **The channel runtime is the source of truth.** SDP stores connection metadata and normalizes state; it does not operate SPC infra.

---

## 2. Architecture & topology

| Service | Default port | Role | Exposure |
|---|---|---|---|
| **Gateway** | `8899` | JSON‑RPC entrypoint. `sendTransaction`→write node, all reads→read node. Optional RBAC. `/health`, `/ready`, CORS. | public |
| Write node (core) | `8900` | Tx pipeline: Dedup → SigVerify → Sequencer → Executor → Settler | loopback only |
| Read node (core) | `8901` | Serves reads from the Postgres replica | loopback only |
| **Streamer** | `8902` | `GET /ws` firehose WebSocket + `/health` | **internal network only** |
| **Auth** | `8903` | `/auth/*`: register, login, wallet challenge/verify, JWT | public (only when enabled) |
| Indexer ×2 | — | Watches escrow (mainnet, Yellowstone gRPC) + withdraw (channel, RPC poll); writes the `indexer` Postgres DB | `/metrics`+`/health` only |
| Operator ×2 | — | Executes the bridge legs (mint‑on‑deposit, release‑on‑withdraw) with its own admin/operator keys | `/metrics`+`/health` only |

**On‑chain programs** (live on devnet/mainnet, *not* the channel):
- Escrow program — token custody, mint allowlist, operators, deposits, releases.
- Withdraw program — burns channel tokens to trigger a mainnet release.

**Data flows:**

| Flow | Path |
|---|---|
| Deposit | Member wallet → **Escrow.Deposit** (devnet L1) → Indexer(escrow) → `indexer` DB → Operator → `MintTo` into channel |
| Transfer | Member wallet → Gateway `sendTransaction` → Write node → Postgres (channel‑only, never touches L1) |
| Withdraw | Member wallet → Gateway `sendTransaction` (**Withdraw.WithdrawFunds** burn) → Indexer(withdraw) → `indexer` DB → Operator → **Escrow.ReleaseFunds** (L1, SMT proof) |
| Reads | Client → Gateway → Read node → Postgres replica |
| Stream | Postgres → Streamer → `/ws` (internal only) |

---

## 3. Connection & environment

### Live devnet sandbox (from prior verification; values may rotate — confirm against the instance)
- **Gateway:** `http://34.71.147.163:8899` — JSON‑RPC subset, **auth currently OFF**.
- **Health‑probe the gateway with `getLatestBlockhash`** (not `getVersion`, which returns "Method not found").
- Escrow program `9tgHa1Dcna…9xXYeU`, Withdraw program `J231K9…vBhVi`, Escrow instance `7C1Pu8…`, USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Routing gotcha:** deposits → devnet RPC (L1); transfers/withdrawals → gateway (channel).
- ⚠️ The repo's docs use placeholder IDs (escrow `GokvZqD2…`); the live instance differs. Always take IDs from the connected instance.

### Auth mode is a per‑instance fact SDP must record
- Auth **OFF** (`JWT_SECRET` unset): gateway is a pure proxy; all reads are open; no wallet‑gating.
- Auth **ON** (`JWT_SECRET` + `AUTH_DATABASE_URL` set, `:8903` exposed): gateway enforces RBAC on read methods; wallet verification becomes meaningful.
- The grant's "Connect instance → Auth status" field maps directly to this. **To use wallet verification / private‑balance gating in the MVP, the SPC operator must enable auth and expose `:8903`** — a coordination item (§10).

---

## 4. Complete API reference

### 4.1 Auth service (`:8903`, REST/JSON) — the entire surface

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | — | `{username, password}` | `{id, username, role, created_at}`; `409` if username taken |
| POST | `/auth/login` | — | `{username, password}` | `{token}` (JWT); `401` on bad creds |
| POST | `/auth/challenge-wallet` | JWT | *(body ignored)* | `{message, nonce, expires_at}` (10‑min TTL) |
| POST | `/auth/verify-wallet` | JWT | `{pubkey, nonce, signature}` | `{pubkey, created_at}`; `401` bad sig, `409` already verified for this user |
| GET | `/auth/wallets` | JWT | — | `[{pubkey, created_at}, …]` for the caller |
| DELETE | `/auth/wallets/{pubkey}` | JWT | — | `204` |
| GET | `/health` | — | — | `200 ok` |

- **Users:** `{username (5–32, unique), password (Argon2)}` — **no email**. Username is the only external join key.
- **Roles:** only `user` (default) and `operator`, **global**, set via the `auth-admin` CLI (`set-role`) — **no HTTP role API**. `attach-wallet` CLI can bind a wallet without a signature (trust assertion).
- **JWT:** HS256, **24 h, no refresh** (re‑login to renew). Claims: `{sub = user uuid, role, iss=private-channel-auth, aud=private-channel-gateway, exp}`. The token binds to the **user uuid, never a wallet**.
- **Challenge message (from source):** `"PrivateChannel wallet verification\nuser: {uuid}\nnonce: {nonce}\nexpires: {unix}"`. (The README's "Solana Private Channels wallet verification" wording is stale — sign the code's exact string.)
- **Verification state = a row in `verified_wallets`.** There is no boolean flag; the row's existence is "verified", and it is what the gateway checks for read gating.

### 4.2 Gateway JSON‑RPC (`:8899`) — 22 Solana methods

`sendTransaction` → write node; every other method → read node. Wire contract matches Solana (`solana-rpc-client-api` types).

**Implemented:** `sendTransaction`, `getAccountInfo`, `getSlot`, `getBlock`, `getTransaction`, `getRecentBlockhash`, `getTokenAccountBalance`, `getLatestBlockhash`, `getSignatureStatuses`, `getTransactionCount`, `getFirstAvailableBlock`, `getBlocks`, `getEpochInfo`, `getEpochSchedule`, `getRecentPerformanceSamples`, `getBlockTime`, `getVoteAccounts`, `getSupply`, `getSlotLeaders`, `isBlockhashValid`, `getSignaturesForAddress`, `simulateTransaction`.

**RBAC when auth is ON** (no effect when off):
- **Operator‑only:** `getBlock`, `getTransaction`, `simulateTransaction` → 401 without JWT, 403 for `user` role.
- **Account‑gated:** `getAccountInfo`, `getTokenAccountBalance`, `getSignaturesForAddress` → `user` may only read accounts owned by a wallet in their `verified_wallets`; otherwise 403.
- **`sendTransaction` is never JWT‑gated** — writes are authorized purely by the Ed25519 signature (SigVerify runs `transaction.verify()`).

**`sendTransaction` specifics:** base64 input only; **no preflight** (failures surface at submit with no sim logs); `maxRetries` ignored. Program allowlist: **SPL Token, ATA, Memo, System, Withdraw** (+ Swap, *not deployed*). Any other program → `-32602`.

**Not implemented (important gaps):**
- `getProgramAccounts`, `getBalance`, `getMultipleAccounts`, `getTokenAccountsByOwner`, `getFeeForMessage`, `requestAirdrop`, `getBlockHeight`, `getVersion`, `getHealth`, and more.
- **The entire WebSocket subscription family** (`accountSubscribe`, `signatureSubscribe`, `logsSubscribe`, …) → `-32601`.

**Gateway REST:** `GET /health` (liveness), `GET /ready` (probes both upstreams), `OPTIONS *` (CORS).

**Client construction:** a stock `solana-rpc-client` / `@solana/web3.js` works unchanged — add `Authorization: Bearer <JWT>` as a default header for gated reads. No SDK fork needed.

**Semantics to know:** single linear timeline → `getSignatureStatuses` returns `Finalized` (or not‑found) with no intermediate state; commitment params accepted and ignored. `getLatestBlockhash` gives `lastValidBlockHeight = slot + 150`; there is no `getBlockHeight` (use `getSlot`).

### 4.3 On‑chain programs (devnet/mainnet — call via the real Solana RPC, not the gateway)

**Escrow program** — instructions (`private-channel-escrow-program`), TS client `private-channel-escrow-program` + `@solana/kit`:
| Instruction | Signer | Purpose |
|---|---|---|
| `CreateInstance` | admin | Init an instance (isolated admin/operators/mints/SMT root) |
| `AllowMint` | admin | Whitelist an SPL/Token‑2022 mint (creates `AllowedMint` PDA + instance ATA) |
| `BlockMint` | admin | Revoke a mint (closes the PDA) |
| `AddOperator` / `RemoveOperator` | admin | Manage withdrawal operators |
| `SetNewAdmin` | admin + new admin | Transfer admin |
| `Deposit` | user (+ payer) | Lock tokens on L1; **permissionless**; optional `recipient` credits a different channel address (third‑party/managed deposits) |
| `ReleaseFunds` | operator | Release escrow with SMT proof (**operator‑driven, not client**) |

**Withdraw program** — `WithdrawFunds` (user‑signed): burns channel tokens, emits an event the indexer picks up.

**PDAs:**
- Instance: `["instance", instance_seed]`
- Allowed mint: `["allowed_mint", instance_pda, mint]` ← *existence = mint is allowed*
- Operator: `["operator", instance_pda, wallet]`
- Event authority: `["event_authority"]`

**Deposit call shape:** `getDepositInstructionAsync({ payer, user, instance, mint, amount, recipient? })`; sign with `payer` + `user`.

### 4.4 Streamer WebSocket (`:8902`, internal only)

`GET /ws` — a **broadcast firehose** with **no subscription/filter protocol** (inbound frames ignored). Message: `{signature, chain, type, from, to, amount, mint, timestamp, status, slot}`. ⚠️ **It is id‑keyed and emits each tx once at insert (usually `pending`); it does NOT re‑broadcast the settlement transition.** Do not rely on it for "did it settle". Built for the admin‑ui activity feed.

### 4.5 Indexer Postgres DB (`indexer`) — the reconciliation ledger, **SQL only, no HTTP**

The `transactions` table joins **both chain legs into one row** — exactly the cross‑system reconciliation SDP wants to avoid doing itself.

- **Keys:** unique `(signature, instruction_index, inner_index)`, unique `trace_id`, unique `counterpart_signature`; indexes on `initiator`, `recipient`, `status`, `slot`.
- **`counterpart_signature`** links the legs: deposit → the channel `MintTo` sig; withdrawal → the L1 `ReleaseFunds` sig.
- **Status state machine (8 states):** `pending → processing → completed` (happy path); plus `parked`, `failed`, `failed_reminted`, `manual_review`, `pending_remint`.
- **Completion** is a CAS that also writes `counterpart_signature` + `processed_at`.
- Other tables: `mints` (metadata, allow/block, `is_pausable`, `has_permanent_delegate`), `mint_status_history` (point‑in‑time allow/block), `indexer_state` (checkpoints), `pending_release_signatures`.
- **Error reason text is NOT stored in the DB** — it rides the failure webhook + logs only. The *status* is queryable; the *reason* is not.

**Failure webhook:** fires **only** on `Failed` / `FailedReminted` / `ManualReview`, to a single `ALERT_WEBHOOK_URL`. Payload: `{transaction_id, trace_id, status, counterpart_signature, error_message, processed_at, timestamp, remint_signature, remint_status}`. Not per‑consumer, not a success signal.

---

## 5. End‑to‑end flows (exact calls)

**Connect / health:** `GET {gateway}/health` + `GET {gateway}/ready`; sanity `getLatestBlockhash`. Record instance address, gateway URL, RPC URL, auth mode.

**Create SPC proxy user + JWT (per SDP user, once):**
1. `POST /auth/register {username, password}` — SDP generates and stores creds, bound to the Clerk‑validated SDP user.
2. `POST /auth/login` → cache `{token}` (24 h; refresh by re‑login).

**Verify a member wallet (member signs, client‑side):**
1. `POST /auth/challenge-wallet` (JWT) → `{message, nonce, expires_at}`.
2. Member's wallet signs `message` (Ed25519) in the browser.
3. `POST /auth/verify-wallet {pubkey, nonce, signature}` → verified.

**Read balances:** for each `(wallet, mint)`, derive the ATA, then gateway `getTokenAccountBalance(ata)` (JWT if auth on). *(No `getTokenAccountsByOwner` — SDP must know the mint set and derive ATAs.)*

**Deposit (L1 → channel):** build Escrow `Deposit` on **devnet**, member signs, submit to **devnet RPC**. Track settlement via the indexer `transactions` row (deposit leg → `completed` with the mint `counterpart_signature`).

**Internal transfer (channel):** build a standard SPL `Transfer` (fromATA→toATA, authority = member), member signs, `sendTransaction` to the **gateway**. Confirm via `getSignatureStatuses` (instant `Finalized`).

**Withdraw (channel → L1):** build Withdraw `WithdrawFunds` (burn), member signs, `sendTransaction` to the gateway. Track via the indexer `transactions` row (withdraw leg → `completed` with the release `counterpart_signature`).

**Poll settlement:** happy path is **poll‑only** — either the indexer row by `trace_id`/signature until `completed`, or `getSignatureStatuses` on the `counterpart_signature`. Use the failure webhook for the error path. Do **not** rely on `/ws`.

---

## 6. Confirmed answers to the open questions

| # | Question | Confirmed answer | SDP implication |
|---|---|---|---|
| Q1 | Multiple SDP users ↔ one SPC user/wallet? SPC's one‑user‑many‑wallets model? | **1 user → N wallets.** JWT binds to user uuid. **Wallet pubkey is NOT globally unique** — only `UNIQUE(user_id, pubkey)`; the same wallet can be verified under multiple users, silently sharing gateway read access. | Map **1 SDP user → 1 SPC proxy user → N wallets**. **SDP must enforce global wallet uniqueness itself** for isolation. |
| Q2 | How does SPC execute transfers? Sign every tx? Internal ones? Need a wallet? | **Client signs all money‑moving txs** (deposit/transfer/withdraw); SPC never signs user transfers. Internal transfer = plaintext SPL transfer on the channel SVM (not encrypted/ZK). Gasless ≠ server‑signed. **A wallet/signer is required even for internal transfers.** | **Yes, a wallet is needed.** Preferred: **member signs client‑side with their own wallet** (matches the grant). Alternative: SDP‑custodied signer (Turnkey/Privy/managed key) for server‑side/non‑interactive flows. JWT‑only, custody‑free execution is impossible. |
| Q3 | Can we poll SPC to avoid monitoring two systems / async txns? | **Yes — SPC already reconciles both chains** into one indexer `transactions` row (`counterpart_signature`, 8‑state machine). BUT **no HTTP API** over it; `/ws` doesn't re‑emit settlement; webhook is failure‑only. | Consume the indexer DB (read replica) by `trace_id`, or fallback = failure‑webhook + RPC poll on `counterpart_signature`. **Coordinate DB access with the operator.** |
| Q4 | How to get the allowed mints? | **On‑chain `AllowedMint` PDA** (`["allowed_mint", instance_pda, mint]`), admin‑managed. **No list endpoint**, and the gateway lacks `getProgramAccounts`. | Enumerate via **`getProgramAccounts` on the real devnet/mainnet RPC** (or track `AllowMint`/`BlockMint` events); mirror in SDP. |

---

## 7. Grant objects & APIs → SPC reality (what to build vs. what to call)

The grant proposes these SDP objects and internal APIs. Here's what each actually maps to:

| Grant object | Backed by | Notes |
|---|---|---|
| `PrivateChannelInstance` (address, gateway URL, RPC URL, auth mode, status) | **SDP‑stored** + gateway `/health` | SPC has no "instance API"; SDP records metadata and health‑probes. |
| `PrivateChannel` (Treasury Ops, Team Payroll) | **SDP‑native (100%)** | SPC has no channel concept. Logical grouping enforced purely by SDP. Keep the schema channel‑aware from day one. |
| `PrivateChannelMember` (user, wallet, role, verification, access) | **Split** | Wallet verification = SPC auth service. Role/access/join‑policy/channel membership = SDP‑native (SPC has only global user/operator). |
| `AllowedPrivateChannelMint` | **SPC on‑chain**, SDP‑mirrored | Read via devnet `getProgramAccounts`/events (Q4). |
| `PrivateChannelEvent` (normalized activity) | **SDP‑normalized** | Compose from gateway RPC (channel txs) + indexer DB (deposit/withdraw status) + SDP's own member/token changes. |
| `PrivateChannelDeposit` | Escrow `Deposit` (L1) + indexer status | |
| `PrivateChannelTransfer` | `sendTransaction` (SPL) + `getSignatureStatuses` | |
| `PrivateChannelWithdrawal` | Withdraw `WithdrawFunds` + indexer status (release `counterpart_signature`) | |

| Grant internal API | SPC mapping |
|---|---|
| connect/get instance | SDP + gateway `/health`, `/ready` |
| list members / invite / remove member | **SDP‑native** (no SPC endpoint) |
| verify wallet | Proxy `POST /auth/challenge-wallet` + `/auth/verify-wallet` |
| list balances | Gateway `getTokenAccountBalance` per `(wallet ATA, mint)` |
| list allowed tokens | Devnet `getProgramAccounts` on escrow instance / SDP mirror |
| create deposit intent | Build Escrow `Deposit` (devnet); track via indexer DB |
| create private transfer intent | Build SPL transfer; `sendTransaction`; track `getSignatureStatuses` |
| create withdrawal intent | Build `WithdrawFunds`; `sendTransaction`; track via indexer DB |
| list events | SDP‑normalized event store |

**Roles/statuses** in the grant UI (Owner/Admin/Member/Viewer; Active/Pending) and **join policy** (require approval, allow devnet testing) are all **SDP‑native** — SPC does not model them.

---

## 8. Key design decisions for SDP

1. **Signing model (from Q2 + grant): member‑wallet client‑side signing.** SDP orchestrates and records; the member's own wallet signs verification, deposits, transfers, and withdrawals. SDP holds the **SPC account credentials** (username/password → JWT, for reads + issuing challenges), *not* the member's wallet key. Only revisit custody (Turnkey/Privy) if a non‑interactive/server‑side flow is required later.
2. **Identity mapping:** 1 SDP user (Clerk) → 1 SPC proxy user (SDP‑generated creds) → N verified wallets. Cache the JWT per SDP user; refresh by re‑login.
3. **Global wallet uniqueness (Q1):** SDP must guard it — SPC won't.
4. **Reconciliation (Q3):** prefer read access to the indexer Postgres replica (poll `transactions.status` by `trace_id`); fallback = failure‑webhook + RPC poll on `counterpart_signature`.
5. **Mints (Q4):** read on‑chain from devnet; mirror + cache in SDP.
6. **Auth mode:** record per instance; the sandbox is currently auth‑OFF, so plan for the operator to enable auth if wallet‑gated reads are in scope.

---

## 9. Recommended SDP data model (grounded)

- `private_channel_instance` — project, environment, instance_address, gateway_url, rpc_url, auth_mode, connection_status.
- `private_channel` — SDP‑native logical channel (name, join_policy, allow_devnet_testing). Channel‑aware from the start even with one `default`.
- `private_channel_member` — sdp_user_id, channel_id, spc_user_id, role (owner/admin/member/viewer), access_status (active/pending), plus link to wallets.
- `spc_proxy_user` — sdp_user_id (1:1), spc_username, spc_credential_ref, cached_jwt, jwt_expires_at.
- `verified_wallet` — member_id, pubkey, verified_at; **global unique on pubkey** (SDP‑enforced).
- `allowed_mint` — instance_id, mint, symbol, decimals, state (mirror of on‑chain).
- `pc_deposit` / `pc_transfer` / `pc_withdrawal` — intent + signature + `trace_id`/`counterpart_signature` + status.
- `pc_event` — normalized activity (type, status, token, channel, actor, created_at).

---

## 10. Coordination items with the SPC operator

- **Enable auth + expose `:8903`?** Needed for wallet‑gated reads/RBAC; otherwise reads are open (no per‑wallet privacy).
- **Indexer Postgres read‑replica access** (for reconciliation) — or ask the operator to expose a transfer‑status endpoint. Without one, SDP falls back to webhook + RPC polling.
- **Live instance facts:** escrow instance ID, escrow/withdraw program IDs, admin authority (the grant limits allow/block‑mint support to "if admin authority is available"), and the authoritative allowed‑mint list.
- **Failure webhook URL** — where should SPC send failure alerts (a single global URL today).

---

## 11. Reference — SPC source paths & sandbox values

- Auth: `auth/src/lib.rs`, `auth/src/routes/*`, `auth/src/db.rs`, `auth/src/jwt.rs`, `auth/README.md`
- Gateway: `gateway/src/lib.rs`, `gateway/src/auth.rs`; RPC surface `core/src/rpc/api.rs`
- Transfer/pipeline: `core/src/rpc/send_transaction_impl.rs`, `core/src/stages/sigverify.rs`, `core/src/vm/gasless_callback.rs`
- Programs: `private-channel-escrow-program/`, `private-channel-withdraw-program/`; guides `docs/ESCROW_INTERACTION_GUIDE.md`, `docs/WITHDRAWING_GUIDE.md`
- Indexer/operator: `indexer/src/storage/postgres/db.rs`, `indexer/src/storage/common/models.rs`, `indexer/src/operator/*`, `docs/INDEXER.md`
- Streamer: `core/src/bin/streamer.rs`
- Client patterns: `demo/src/utils/solana.ts`; devnet e2e `scripts/devnet/devnet-test.sh`
- Overall: `docs/ARCHITECTURE.md`, `docs/RPC_COMPATIBILITY_ANALYSIS.md`

Sandbox (rotate‑prone): gateway `http://34.71.147.163:8899` (auth OFF); escrow program `9tgHa1Dcna…9xXYeU`; withdraw `J231K9…vBhVi`; instance `7C1Pu8…`; USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
