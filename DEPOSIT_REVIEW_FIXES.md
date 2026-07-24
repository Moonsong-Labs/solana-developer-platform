# Private Channels — Deposit review findings & fix plan

Status: PLAN (doc only, no code changes yet) · Branch: `feat/spc-deposits` (PR #8)
Related: `private-channels-settlement-ledger-design.md` (one level above the repo),
`WITHDRAWAL_PLAN.md` + `WITHDRAWAL_EMPIRICAL_TEST.md` (on `feat/spc-withdrawals`, PR #9).

Findings from review (2026-07-20), each verified against the code on `feat/spc-deposits`.
**All six are valid — no false positives.** What this doc adds is severity calibration,
prioritization, and the fix direction.

---

## Prioritization (read this first)

The findings split into two groups with very different urgency:

| Group | Findings | Why |
|---|---|---|
| **P0 — live devnet-path bugs** | #1 idempotency, #2 broadcast-error | On the custody-wallet → devnet broadcast path, which is **not** gateway-auth-gated. Can double-debit or wrongly abandon real funds. Fix regardless of anything else, and **fix them together** (see below). |
| **P1 — fold into the settlement-ledger redesign** | #3 snapshot grouping, #4 balance-decrease, #6 no timeout/manual-review | All describe the *balance-delta credit heuristic*, which is already slated for replacement. Also currently unreachable: baseline capture (`deposit.ts:163`) is itself a gateway read, so on the auth-gated gateway `createChannelDeposit` throws before broadcasting. **Don't patch a mechanism we're deleting** — fix as part of the ledger work. |
| **P2 — independent** | #5 scan fairness, test coverage, web tab gating | Orthogonal to the above; schedule separately. |

---

## P0

### 1. `POST /deposits` is not idempotent — High
`routes/private-channels/schemas.ts:49` (`createDepositBodySchema`) accepts `{walletId, amount, recipient?}` only, and every call builds and broadcasts a **fresh** transaction. A client retry after an HTTP timeout debits the custody wallet twice.

> Note: Solana's own signature dedup does **not** protect here — the retry has a new blockhash → new signature → a genuinely different tx. Idempotency must live at the SDP layer.

**Fix:** client-supplied idempotency key; project-scoped unique constraint; replay the original stored result on repeat.

### 2. A broadcast transport error is treated as proof no funds moved — High (most important)
`services/private-channels/deposit.ts` — `broadcastDeposit` returns the result of `sendTransaction`, so the signature only exists *after* the RPC responds. Any rejection hits the catch (~:188) and marks the row terminally `failed`; the comment even encodes the wrong assumption ("no signature, so … no funds moved"). The RPC may have accepted and lost the response. Same window exists for a process crash after acceptance but before the signature is persisted (~:207).

**Fix:** the tx is fully signed locally *before* sending — derive the signature (`getSignatureFromTransaction(signed)`) and persist `submitted` + signature **before** `sendTransaction`; treat a send timeout as `submitted` and let the reconciler settle it from signature status.

> **#1 and #2 are coupled:** an idempotency key alone doesn't help if the signature isn't persisted before send — a crashed first attempt leaves nothing to replay and the retry builds a new tx. Solve together.

---

## P1 — fold into the settlement-ledger redesign

### 3. Deposits with different config snapshots are reconciled together — High (narrower than it reads)
`services/jobs/track-pending-deposits.ts:98` — `creditGroupKey` is `instance_id|recipient|mint`; `reconcileCreditGroup` then reads only `deposits[0]`'s snapshot (:186) for the whole group. `listDepositsForRecipient` likewise returns all snapshots.

*Calibration:* reactivation is keyed **by gateway URL** (`findByProjectAndGateway`) and a genuinely new gateway creates a **new** `instance_id`, so the exact "gateway changes under the same ID" trigger is hard to reach — but `chainRpcUrl`/escrow **can** drift via `reactivateAndUpdate`, so the defect (grouping ignores snapshot divergence) is real.

**Fix:** key the group *and* the query on the snapshot (or an immutable config-version id). Precedent already exists: the withdrawal reconciler groups by `escrow_instance_addr|mint|chain_rpc_url`.

### 4. Cumulative accounting breaks after a balance decrease — High (the fundamental one)
`services/jobs/deposit-credit.ts:44` — `needed` starts at the oldest baseline and adds **every** non-failed deposit's amount, including already-`credited` ones (`needed += …` runs before the `credited` `continue`), so the threshold only ever grows. Example: deposit 10 (credited) → withdraw/spend 10 → deposit 5. Observed balance 5, required 15 → the new deposit never credits.

This is the mutable-aggregate-balance-as-settlement-evidence limitation documented in the settlement-ledger design; it's the primary driver for that redesign.

**Fix (interim, matches the design's single-flight):** one outstanding operation per `(config-version, recipient, mint)`, a fresh baseline per operation, and block outbound mutations on the bucket while it settles.
**Fix (durable):** correlation-based ledger — idempotent entries keyed on a settlement ref, balance as a `SUM` projection, never a read-modify-write of an aggregate.

### 6. No settlement timeout / manual-review state — Medium
A `confirmed` deposit the gateway never reflects stays `confirmed` forever: it keeps hot-polling, holds the head of the oldest-first queue (see #5), and **permanently blocks instance deletion** because `countNonTerminalByInstance` counts `confirmed` as non-terminal.

**Fix:** after a bounded interval move to a non-failure terminal-ish state (`manual_review` / `credit_unknown`), stop hot polling, exclude from the delete guard, and make it operator-resolvable. Precedent: the withdrawal reconciler already does exactly this (`manual_review` + timeout).

---

## P2 — independent

### 5. Global oldest-100 scan can starve newer deposits — Medium
`services/jobs/track-pending-deposits.ts:34` selects the oldest 100 non-terminal rows by `updated_at ASC`. A `confirmed` row that can't be credited never advances `updated_at`, so 100 stuck rows indefinitely block newer `submitted` deposits from being confirmed — **across organizations** (the scan is global).

**Fix:** separate confirmation and credit queues; add `next_attempt_at` + backoff; paginate or fairly partition work.

### Test coverage
The live integration test covers a single successful deposit. Add cases for: idempotent retry, ambiguous send failure, config drift under the same `instance_id`, balance decrease, queue saturation, and permanently-missing credit. These map 1:1 to #1–#6.

### Web navigation gating
The Deposit tab (`private-channels-header-tabs.tsx`) is gated on `requiresActive: true` only, so non-admins see it and discover the `projects:admin` restriction as a 403 on submit. Minor (the API gate is the real control) — add an admin check to the tab for defense-in-depth UX.

---

## Confirmed-good (no action)

- `transfer.deposit.submitted` / `transfer.deposit.credited` emission is correct; the credited emit is properly protected by the status compare-and-swap.
