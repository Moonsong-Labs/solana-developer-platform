# Private Channels — Withdrawal Flow Plan

Status: PLAN (doc only) · Branch: `feat/spc-withdrawals` (based on `feat/spc-deposits`)
Aligns to: `private-channels-settlement-ledger-design.md` (the settlement-ledger / money-movement
reconciliation design). Read that first — this plan is the withdrawal-specific application of it.

> Scope of this document: describe the end-to-end withdrawal flow, the status model, release
> detection, the data model, and the concrete files + sequencing. It does **not** implement the
> service / routes / web — those are deliberately deferred until the deposit rework (per the
> settlement-ledger design) lands, to avoid churning against a moving base.

---

## 1. What a withdrawal is

A withdrawal moves a user's **channel-chain** balance back out to real USDC on **devnet**:

1. **USER signs** a `withdrawFunds` instruction — an SPL **`Burn`** of the user's channel-chain
   token balance (discriminator `0`, args `amount: u64`, `destination: Option<Pubkey>`; 5 accounts:
   `user` signer, `mint`, `tokenAccount` = user's classic-Token ATA, `tokenProgram`,
   `associatedTokenProgram`). Built with the new `@sdp/spc-withdraw` codama client (Deliverable 1,
   done).
2. **SDP broadcasts the signed burn to the GATEWAY** (the channel chain), *not* to devnet. SDP is a
   relay here; the **user** is the signer. (Contrast with deposits, whose escrow tx SDP custody-signs
   and broadcasts to devnet.)
3. The **OPERATOR later releases real USDC on devnet** from the escrow **instance ATA** to the
   `destination`. **SDP never signs the devnet side** and never moves escrow funds.
4. SDP **detects** the devnet release, records the release signature as the settlement correlation
   (`settlement_ref`), and appends a `withdrawal_debit` entry to the settlement ledger.

Key asymmetry vs deposits (settlement-ledger design §8): **withdrawal release detection is NOT
auth-gated** — the release lands on devnet (public) and is found with an unauthenticated
`getSignaturesForAddress` on the instance ATA. So **withdrawals can become authoritative before
deposits do** (deposit crediting is blocked on the gateway JWT / operator credit-event work).

---

## 2. Status model (state machine)

Mirrors the settlement-ledger design §5 withdrawal machine exactly:

```
pending → submitted → burn_confirmed → release_pending → released
                  ↘ failed
submitted / release_pending → manual_review
```

- `pending` — intent persisted; bucket lock claimed (see §5); burn not yet broadcast.
- `submitted` — signed burn accepted by the gateway (has a channel-chain signature).
- `burn_confirmed` — burn confirmed on the channel chain (authoritative: the user's balance is gone).
- `release_pending` — waiting for the operator's devnet release.
- `released` — devnet release detected + `withdrawal_debit` ledger entry appended. **Terminal.**
- `failed` — **only** from an authoritative pre-burn failure (gateway rejected the tx, burn failed
  on chain). **Terminal.**
- `manual_review` — anything uncertain **after** `burn_confirmed` (release not seen within the
  timeout, ambiguous match, etc.). **Terminal-ish** (resolved by an operator).

Non-negotiable invariants (design §6, §9.2, §5):
- **Transport ≠ business failure.** A network/timeout error bumps retry metadata and leaves the
  state unchanged. Only an authoritative chain/operator result is terminal.
- **Never auto-`failed` after `burn_confirmed`.** Once the burn confirms, the user's channel balance
  is gone; if the release can't be observed, it is a *settlement* problem → `manual_review`, never
  `failed`. (Symmetric to the deposit rule "never `failed` after on-chain confirmation".)
- **Monotonic, guarded (CAS) transitions:** `UPDATE … SET status=? WHERE id=? AND status=<expected>`
  so concurrent reconciler workers can't regress state.

---

## 3. Release detection (the authoritative signal)

Withdrawals have a clean, public correlation signal that deposits lack:

- Poll devnet **`getSignaturesForAddress` on the escrow *instance ATA*** (the source of the release
  transfer). For each new signature, `getTransaction` and look for an **outgoing** USDC transfer
  matching `(mint, destination, amount)` of a `release_pending` withdrawal.
- On a match: record the **devnet release signature** as `settlement_ref` and append a
  `withdrawal_debit` entry to `private_channel_ledger_entries` — **idempotent**, `INSERT … ON
  CONFLICT DO NOTHING` on the `UNIQUE (settlement_ref)` (equivalently `UNIQUE (source_kind,
  source_id, kind)`). This is the exactly-once guarantee from design §4.2; it removes any
  double-debit race.
- Then CAS `release_pending → released`.
- This detection path is **unauthenticated** (devnet is public), unlike deposit crediting.

Matching caveats (to firm up with SPC — design §11 Q4): if multiple withdrawals share
`(mint, destination, amount)` they can't be told apart by content alone. Mitigations, in order:
(a) an operator-relayed **memo / withdrawId** on the release tx (best — makes the match exact); else
(b) the **single-flight bucket lock** (§5) already guarantees at most one in-flight op per
`(instance, recipient/owner, mint)`, so ordering + amount is unambiguous per bucket; else
(c) FIFO-match the oldest `release_pending` with that content. Prefer (a); (b) is the floor.

Balance is a **projection**, never a mutated cell: `balance(owner, mint) = SUM(signed ledger
amounts)`. The `withdrawal_debit` entry is a negative contribution; no read-modify-write.

---

## 4. Data model (withdrawal-specific)

Reuse the intent + ledger + lock model from design §4.

### 4.1 Withdrawal intent (`private_channel_withdrawals`, migration `0029`)
Immutable except for guarded status/retry updates. Fields (mirror the deposit intent shape):
- SDP id `wd_…`, org / project / wallet / owner / **destination** / mint / amount.
- Instance-config snapshot (interim D2 form, design §9.3): **gateway URL, chain RPC URL, escrow
  program, escrow instance address** captured at creation so a later reconnect can't change the
  reconciliation context. (Durable form = `instance_version_id` once instance versioning lands.)
- `burn_signature` (channel chain), `burn_slot`.
- `release_signature` (devnet — the `settlement_ref`), matched `(mint, destination, amount)`.
- Per-transition timestamps.
- `failure_category` + retry metadata (`retry_count`, `last_error`, `next_attempt_at`).
- No FK / no cascade — survives instance deletion (design §4.1, §7).

### 4.2 Settlement ledger entry (shared table `private_channel_ledger_entries`)
A withdrawal produces one ledger row on `released`:
- `kind = withdrawal_debit`, `direction = debit` (signed-negative amount).
- `owner`, `mint`, denormalized `organization_id` / `project_id` / `instance_id`.
- `source_kind = withdrawal`, `source_id = wd_…`, `settlement_ref = <devnet release signature>`.
- **`UNIQUE (settlement_ref)`** — the idempotency key.
> The ledger table itself is introduced by the **deposit rework** (design §12 step 2, migration
> `0030`). Withdrawals only *append* to it; this plan does not create the ledger table.

### 4.3 Balance-operation lock (shared `private_channel_balance_operations`, design §4.6)
- `UNIQUE (instance_id, recipient/owner, mint)` — at most one in-flight balance op per bucket.
- A withdrawal **is a balance-affecting op** and MUST participate in the same lock as deposits and
  transfers: a `withdrawal_debit` on a bucket must not run while a deposit on the **same bucket** is
  `credit_pending` (and vice-versa) — otherwise the deposit's `observed ≥ baseline + amount`
  inference is destroyed (design §4.6 worked example). Claim the lock in the **same transaction**
  that creates the withdrawal; release on `released` / authoritative pre-burn `failed` / manual
  resolution. If the bucket is busy → **reject or queue** the new withdrawal.

---

## 5. Processing / reconciliation

- A reconciler `track-pending-withdrawals.ts` advances `submitted → burn_confirmed →
  release_pending → released`, using the devnet release-detection of §3. Runs on the same cron
  seam as deposits (`cron/pending-withdrawals.ts`, mirroring `cron/pending-deposits.ts` /
  `PENDING_DEPOSITS_CRON`).
- Handlers are **idempotent** (safe to re-run) and use CAS transitions.
- Timeout waiting for release (align to the deposit 5–10 min budget) → `manual_review`, **not**
  `failed`.
- Longer-term this folds into the design §6 durable job queue (`FOR UPDATE SKIP LOCKED`,
  backoff, dead-letter → `manual_review`) — a platform-level change shared with the deposit and
  transfer reconcilers; do the incremental scan now if shipping sooner.

---

## 6. Open dependencies / risks to verify

1. **Gateway auth on the burn broadcast (⚠️ verify).** Gateway auth is now ON. Empirically
   `getLatestBlockhash` is open but private reads/writes may require the **JWT** (design §9.2).
   The withdraw burn is a **write** (`sendTransaction`) to the gateway — confirm whether the
   gateway accepts an unauthenticated user-signed `sendTransaction`, or whether it needs the JWT
   from the wallet-verification work (`feat/spc-wallet-*`). The gateway client already has the
   `Authorization` header seam. **If the write is JWT-gated, the whole withdrawal submit path is
   blocked on the JWT work** — flag this early.
2. **Release-tx matchability (design §11 Q4).** Confirm with SPC that the devnet release is
   discoverable on the instance ATA and matchable by `(mint, destination, amount)`, ideally with a
   memo/id. Drives whether §3(a) exact-match or §3(b) single-flight is the correlation floor.
3. **Gateway fee model for user-signed gateway txs (design §11 Q5).** The burn is user-signed and
   gateway-broadcast; confirm who pays fees on the channel chain (mirrors the deposit self-pay /
   Kora escrow allowlist concern).
4. **Sole-mutator assumption (design §9.4, §11 Q6).** Balance-projection soundness assumes SDP
   controls all mutations of the bucket. If external clients/operator can move it, manual
   reconciliation is inherent — but note withdrawal *release* detection (devnet signature match) is
   robust to this because it correlates a specific signature, not a balance diff.

---

## 7. Reuse map (from the deposit flow)

> ⚠️ The deposit flow is being **reworked** per the settlement-ledger design (balance-delta credit
> detection is being replaced by the ledger + correlation model). So the withdrawal service /
> routes / web should be built **after** that rework lands, mirroring the *reworked* deposit
> shapes rather than today's. The list below maps today's deposit files to their withdrawal
> siblings for reference.

| Concern | Deposit (existing) | Withdrawal (to create) |
|---|---|---|
| Migration | `0027_private_channel_deposits.sql` (ledger = `0030`, events took `0028` on dev) | `0029_private_channel_withdrawals.sql` |
| Repository | `db/repositories/private-channel-deposit.repository.ts` (+ `.postgres.ts`) | `private-channel-withdrawal.repository.ts` (+ `.postgres.ts`); register in `repository-factory.ts` |
| Service | `services/private-channels/deposit.ts` (`createChannelDeposit` / `getChannelDeposit`; broadcasts to **devnet** `chainRpc`) | `services/private-channels/withdraw.ts` (`createChannelWithdrawal` / `getChannelWithdrawal`; broadcasts the user-signed burn to the **GATEWAY** via `createChannelGatewayRpc` from `@sdp/private-channels`, **not** devnet) |
| Routes | `routes/private-channels/handlers/deposits.ts` (`create/get/list PrivateChannelDeposit`) | `handlers/withdrawals.ts` → `POST /withdrawals`, `GET /withdrawals/:id`, `GET /withdrawals`; wire in `routes/private-channels/index.ts` + `schemas.ts` |
| DTO | `PrivateChannelDeposit` (`openapi/schemas/private-channels.ts`) | `PrivateChannelWithdrawal` |
| OpenAPI | `openapi/paths/private-channels.ts` (deposit paths) | add withdrawal paths + schema |
| Reconciler | `services/jobs/track-pending-deposits.ts` + `cron/pending-deposits.ts` (`trackPendingDeposits`, balance-based — being reworked) | `services/jobs/track-pending-withdrawals.ts` + `cron/pending-withdrawals.ts`; uses **devnet `getSignaturesForAddress` on the instance ATA** release detection (§3), not a balance diff |
| Ledger append | (deposit rework adds `deposit_credit`) | `withdrawal_debit` entry into `private_channel_ledger_entries`, `UNIQUE (settlement_ref)` |
| Bucket lock | claimed on deposit create | claimed on withdrawal create, **same** `(instance, owner, mint)` mutex (§4.3) |
| On-chain client | `@sdp/spc-escrow` (`getDepositInstructionAsync`) | **`@sdp/spc-withdraw`** (`getWithdrawFundsInstructionAsync`) ✅ built |
| Web | `sdp-web/.../private-channels/deposit/` (`page.tsx`, `deposit-form.tsx`, `deposit-progress.tsx`, `actions.ts`) + tab | `private-channels/withdraw/` (`page.tsx`, `withdraw-form.tsx`, `withdraw-progress.tsx`, `actions.ts`) + Withdraw tab. **User wallet signs the burn client-side**, then posts the signed tx to `POST /withdrawals`. |

---

## 8. Concrete files to create (and sequencing)

**Done now (unblocked):**
- ✅ `packages/sdp-spc-withdraw/` — the `@sdp/spc-withdraw` codama client (generate + typecheck +
  unit tests green). Exposes `getWithdrawFundsInstructionAsync`, `WITHDRAW_FUNDS_DISCRIMINATOR`,
  `PRIVATE_CHANNEL_WITHDRAW_PROGRAM_ADDRESS`.

**After the deposit rework lands (so we mirror the reworked shapes, not today's):**
1. `apps/sdp-api/src/db/migrations/postgres/0029_private_channel_withdrawals.sql` — the withdrawal
   intent table (§4.1). (Ledger table + balance-op lock come from the deposit rework, `0030`.)
2. `apps/sdp-api/src/db/repositories/private-channel-withdrawal.repository.ts` (+ `.postgres.ts`);
   register in `repository-factory.ts`.
3. `apps/sdp-api/src/services/private-channels/withdraw.ts` — persist (`pending`) + claim bucket
   lock, broadcast the **user-signed** burn to the **gateway** (`createChannelGatewayRpc`),
   `submitted`. ⚠️ gated on gateway-write auth (§6.1).
4. `apps/sdp-api/src/routes/private-channels/handlers/withdrawals.ts` + wiring in
   `routes/private-channels/index.ts` + `schemas.ts`; DTO `PrivateChannelWithdrawal` in
   `openapi/schemas/private-channels.ts`; paths in `openapi/paths/private-channels.ts`.
5. `apps/sdp-api/src/services/jobs/track-pending-withdrawals.ts` + `cron/pending-withdrawals.ts` —
   the devnet release-detection reconciler (§3) advancing `submitted → burn_confirmed →
   release_pending → released`, appending the `withdrawal_debit` ledger entry idempotently.
   **This reconciler is NOT auth-gated** and can be built/tested against devnet independently of the
   gateway JWT work.
6. `apps/sdp-web/src/app/dashboard/payments/private-channels/withdraw/` page + form + progress +
   actions, and a Withdraw tab alongside Deposit.

**Sequencing summary:** client ✅ now → (deposit rework) → withdrawal intent table + repo + service
+ routes + web → devnet release-detection reconciler. The reconciler and client are the
auth-independent pieces; the **submit/broadcast path is the one blocked on gateway-write auth**.
