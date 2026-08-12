# Merchant Pay Phase 2 Transaction Protocol Implementation Plan

> **For Claude:** REQUIRED: Use core-engineering:subagent-driven-development (if subagents available) or core-engineering:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement hosted prepare, wallet-sign-only submit, SDP sponsorship/submission, and crash-safe reconciliation through confirmed and finalized settlement.

**Architecture:** Hosted prepare persists one exact transaction message without the sponsor signature. Submit validates the payer-signed bytes, enforces policy before invoking the fee-payer signer, adds the sponsor signature, strictly simulates, persists the deterministic signature and inbound transfer, and sends through the fee-payment port. A claimed attempt state machine and reconciliation job own all ambiguous outcomes.

**Tech Stack:** TypeScript, Hono, PostgreSQL, `@solana/kit` v6, `@solana-program/system`, `@solana-program/token-2022`, `@sdp/rpc`, `@sdp/payments/fee-payment`, policy engine, Vitest.

**Depends on:** Phase 1 at `docs/architecture/merchant-pay-phase-1-foundation-plan.md`.

**Out of scope:** Browser wallet integration, dashboard UX, settlement webhooks, refunds, split payments, and arbitrary merchant transactions.

**Hard gate:** Do not start Phase 2 until Phase 1 migrations, request/attempt
repositories, checkout-token lookup, guarded transitions, shared types, and
authenticated API contracts are merged and green. Phase 3 at
`docs/architecture/merchant-pay-phase-3-hosted-checkout-plan.md` completes the
browser and merchant-facing product after this backend protocol.

---

## Chunk 1: Signing and transaction primitives

### Task 1: Add submit-only fee-payment behavior

**Files:**
- Modify: `packages/sdp-payments/src/fee-payment/port.ts:43-70`
- Modify: `packages/sdp-payments/src/fee-payment/native.adapter.ts:63-122`
- Modify: `packages/sdp-payments/src/fee-payment/kora.adapter.ts:142-201`
- Modify: `apps/sdp-api/src/types/env.d.ts`
- Modify: `packages/sdp-env-config/src/fields.ts`
- Modify: `scripts/secret-keys.mjs`
- Modify: `turbo.json`
- Modify: `infra/self-hosted/compose.yml`
- Modify: `apps/sdp-api/src/test/helpers/env.ts`
- Modify: `apps/sdp-api/src/services/adapters/fee-payment/native/native.adapter.test.ts`
- Modify: `apps/sdp-api/src/services/adapters/fee-payment/kora/kora.adapter.node.test.ts`
- Create: `apps/sdp-api/src/services/adapters/fee-payment/fee-payment-contract.test.ts`

- [ ] **Step 1: Write failing adapter contract tests**

Add tests that pass an already fully signed transaction and assert:

```typescript
const result = await adapter.submitSignedTransaction(signedBytes);
expect(result).toEqual({
  signature: expectedSignature,
  disposition: "accepted",
});
expect(signTransactionMock).not.toHaveBeenCalled();
expect(signAndSendTransactionMock).not.toHaveBeenCalled();
expect(sendTransactionMock).toHaveBeenCalledTimes(1);
```

Also assert the submitted bytes are byte-identical, already-known RPC results
are typed as successful replay, the returned RPC signature equals
`getSignatureFromTransaction(decodedTransaction)`, and errors distinguish
`definitive_rejection` from `ambiguous_transport`.

- [ ] **Step 2: Run package tests and confirm failure**

```bash
pnpm --filter @sdp/api test -- src/services/adapters/fee-payment
```

Expected: FAIL because `submitSignedTransaction` is absent.

- [ ] **Step 3: Extend `FeePaymentPort`**

Add:

```typescript
/** Submit already fully signed bytes without modifying signatures or message. */
submitSignedTransaction(
  transaction: Uint8Array,
  rpc: SolanaRpc
): Promise<{
  signature: Signature;
  disposition: "accepted" | "already_known";
}>;
```

Also add:

- a typed submission error carrying
  `certainty: "definitive_rejection" | "ambiguous_transport"`;
- `getFeePayerAddress()`, whose contract forbids loading or constructing a
  signing-capable key;
- lazy signing-key access confined to `signAsFeePayer`/`signAndSend`.

- [ ] **Step 4: Implement Native adapter submit-only**

Refactor its existing retrying RPC send from `signAndSend` into a private
shared helper. `submitSignedTransaction` must call only that helper. Native
hosted operation requires a trusted configured fee-payer public address;
validate it against the private-key-derived signer address on first actual
sign, but do not construct the signer in `getFeePayerAddress()`.
Register `FEE_PAYER_PUBLIC_KEY` through API env typing, env-config, deployment
pass-through, Turbo, self-hosted compose, and test fixtures. Require it when
the Native adapter serves hosted checkout.

- [ ] **Step 5: Implement Kora adapter submit-only**

Kora has no send-only transport method. Keep the single fee-payment boundary by
submitting the fully signed bytes through the caller-provided project
`SolanaRpc` from inside the adapter;
do not call Kora signing endpoints again. Reuse the adapter's environment and
the same transient retry classification as Native. Map already-processed to
successful replay, deterministic RPC rejection to definitive, and timeout,
connection, or unknown-after-send outcomes to ambiguous.

- [ ] **Step 6: Run tests and module boundaries**

```bash
pnpm --filter @sdp/api test -- src/services/adapters/fee-payment
pnpm check:module-boundaries
```

Expected: PASS; `@sdp/payments` remains within its allowed `@sdp/rpc`,
`@sdp/solana`, and `@sdp/types` dependencies.

- [ ] **Step 7: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 2: Add strict transaction simulation

**Files:**
- Modify: `packages/sdp-rpc/src/solana.ts:423-450`
- Modify: `apps/sdp-api/src/services/solana/rpc.test.ts`

- [ ] **Step 1: Write a failing strict-simulation test**

Assert the RPC receives:

```typescript
{
  encoding: "base64",
  commitment: "confirmed",
  sigVerify: true,
}
```

when the caller passes `{ sigVerify: true }`, while existing callers retain
their current default.

- [ ] **Step 2: Extend the helper**

Use:

```typescript
simulateTransaction(rpc, transaction, {
  commitment?: Commitment;
  sigVerify?: boolean;
})
```

Default `sigVerify` to `false` for compatibility; Merchant Pay must pass
`true`.

- [ ] **Step 3: Run RPC tests**

```bash
pnpm --filter @sdp/api test -- src/services/solana/rpc.test.ts
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 3: Extract the hosted transfer-message builder

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/build-hosted-transfer-message.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/build-hosted-transfer-message.test.ts`
- Modify: `apps/sdp-api/src/routes/pay.ts:98-157`
- Reuse: `apps/sdp-api/src/routes/payments/token-accounts.ts:212-330`

- [ ] **Step 1: Write failing SOL/SPL construction tests**

For SOL and SPL assert:

- version-0 message;
- expected external payer signer;
- configured sponsor address as fee payer;
- persisted blockhash/last-valid height;
- exact recipient/mint/base-unit amount;
- persisted reference account;
- no sponsor signature;
- no compute-budget, merchant-supplied, or lookup-table instructions.

The initial protocol emits no compute-budget instruction and therefore pays no
priority fee. Strict simulation later enforces
`MERCHANT_PAY_MAX_COMPUTE_UNITS=100000`.

- [ ] **Step 2: Implement a pure builder**

Input:

```typescript
interface BuildHostedTransferMessageInput {
  rpc: SolanaRpc;
  payer: Address;
  feePayer: Address;
  recipient: Address;
  token: Address;
  amount: string;
  reference: Address;
  lifetime: BlockhashWithExpiry;
}
```

Output includes compiled transaction, canonical `messageBytes`, and semantic
description needed for persistence/tests.

- [ ] **Step 3: Reuse builder primitives without changing legacy behavior**

Refactor only shared instruction construction where safe. Legacy
`solana_pay` `/tx` may still sponsor-sign at prepare; hosted code must stop
before `signAsFeePayer`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/build-hosted-transfer-message.test.ts
pnpm --filter @sdp/api test -- src/services/payments/payment-requests.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 4: Add supported-mint and Token-2022 extension validation

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/validate-merchant-pay-token.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/validate-merchant-pay-token.test.ts`
- Reuse: `apps/sdp-api/src/routes/payments/token-accounts.ts:212-246`

- [ ] **Step 1: Write failing mint-policy tests**

Cover:

- SOL accepted;
- allowed SPL Token mint accepted;
- allowed plain Token-2022 mint accepted;
- mint absent from `project.settings.merchantPayAllowedMints` rejected;
- mint/address from a cluster other than the project's configured cluster rejected;
- unsupported mint/program rejected;
- transfer-fee, transfer-hook, confidential-transfer, default-frozen,
  permanent-delegate, non-transferable, or unknown Token-2022 extensions
  rejected;
- frozen/paused mint or source/destination accounts rejected;
- amount must be exactly representable at mint decimals.

- [ ] **Step 2: Implement fail-closed mint inspection**

Use official `@solana-program/token-2022` account decoders and the configured
cluster RPC. SOL is intrinsically allowed; every SPL/Token-2022 mint must be in
the authenticated project's `merchantPayAllowedMints` setting and exist on
that same project cluster. Start fail-closed:

```typescript
const MERCHANT_PAY_ALLOWED_MINT_EXTENSIONS = [] as const;
const MERCHANT_PAY_ALLOWED_TOKEN_ACCOUNT_EXTENSIONS = ["immutableOwner"] as const;
```

Any mint extension is therefore rejected in the initial release; Token-2022
ATAs may carry only `immutableOwner`. Expand either list only through an
explicit reviewed product/security change. Revalidate mint owner, decimals,
extension set, paused/frozen state, source owner/balance/extensions, and
destination owner/extensions from fresh RPC account data immediately before
sponsorship as well as during prepare.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/validate-merchant-pay-token.test.ts
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 5: Validate payer-signed transactions exactly

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/validate-payer-signed-transaction.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/validate-payer-signed-transaction.test.ts`

- [ ] **Step 1: Write adversarial failing tests**

Start from one valid payer-signed transaction and mutate each independently:

```text
message bytes, version, fee payer, payer, signer order, payer signature,
sponsor signature slot, blockhash, recipient, amount, mint, token program,
ATA, reference, account writability, extra instruction, lookup table,
transaction size
```

Every mutation must return a stable machine code and never consume the
attempt.

- [ ] **Step 2: Implement canonical message comparison**

Decode with `getTransactionDecoder()`. Compare
`transaction.messageBytes` byte-for-byte (and SHA-256 digest in constant time)
against the stored issued message. Reject unsupported versions and address
lookup changes.

- [ ] **Step 3: Verify signer slots and payer signature**

Before sponsorship:

- fee payer must be signer index `0`;
- payer must occupy the exact signer slot persisted at prepare;
- expected payer signature must be present and Ed25519-valid over exact
  `messageBytes`;
- sponsor signature slot must still exist and be all-zero/absent;
- no unexpected signature may be present.

Use `getPublicKeyFromAddress` and `verifySignature` from the installed
`@solana/kit` v6 surface. No new cryptography package is needed.

- [ ] **Step 4: Validate semantic instructions**

Decode the exact allowed System or Token instruction sequence and compare every
program/account/amount/mint/reference field to persisted request/attempt data.
Exact message equality remains the primary guard; semantic checks are defense
in depth.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/validate-payer-signed-transaction.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 2: Hosted prepare and submit APIs

### Task 6: Implement one-live-attempt prepare

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/prepare-attempt.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/prepare-attempt.test.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/resolve-project-rpc.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/resolve-project-rpc.test.ts`
- Create: `apps/sdp-api/src/routes/pay/attempts.ts`
- Modify: `apps/sdp-api/src/routes/pay.ts`
- Modify: `apps/sdp-api/src/services/payments/payment-requests.ts:43-70`

- [ ] **Step 1: Write failing prepare tests**

Test:

- valid hosted checkout token creates `patt_*`;
- same payer replays an unexpired prepared attempt byte-for-byte;
- different payer receives `409`;
- expired/failed attempt permits a fresh prepare;
- paid/canceled/expired/processing request rejects prepare;
- hosted request never calls `findReference`;
- legacy `/pay/:token/tx` rejects hosted mode;
- rate/attempt limits fail before sponsorship work.

- [ ] **Step 2: Add request schema**

Strict body:

```typescript
z.object({ account: z.string().refine(isAddress) }).strict()
```

- [ ] **Step 3: Implement prepare orchestration**

Order:

1. hash/resolve checkout token;
2. verify hosted mode and payable request;
3. replay/reject existing live attempt;
4. generate the candidate `patt_*` ID and validate payer/mint;
5. call address-only `getFeePayerAddress`;
6. resolve the project-selected `SolanaRpc`, verify its genesis hash against
   the project environment, then obtain blockhash and build the exact message;
7. atomically persist the attempt with canonical message/hash and unsigned
   wire transaction before any policy operation exists;
8. handle live-attempt unique races by replaying the winner;
9. return attempt ID, transaction, expiry, and last-valid height.

Do not create a policy operation or call `signAsFeePayer` during prepare.
`resolve-project-rpc.ts` must use the authenticated project's `rpcProvider` /
`rpcEndpoint` and server-side provider credentials, never checkout input.

- [ ] **Step 4: Mount the sub-route**

```text
POST /pay/:checkoutToken/attempts
```

Keep public route responses payer-safe and body-size/rate limited.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/prepare-attempt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 7: Implement claimed, policy-gated submit

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/submit-attempt.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/submit-attempt.test.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/sponsorship-limits.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/sponsorship-limits.test.ts`
- Create: `apps/sdp-api/src/db/migrations/postgres/0052_merchant_pay_sponsorship_reservations.sql`
- Create: `apps/sdp-api/src/db/repositories/merchant-pay.repository.ts`
- Create: `apps/sdp-api/src/db/repositories/merchant-pay.repository.postgres.ts`
- Create: `apps/sdp-api/src/db/repositories/merchant-pay.repository.test.ts`
- Modify: `apps/sdp-api/src/db/repositories/policy.repository.ts`
- Modify: `apps/sdp-api/src/db/repositories/policy.repository.postgres.ts`
- Modify: `apps/sdp-api/src/db/repositories/policy.repository.test.ts`
- Modify: `apps/sdp-api/src/types/env.d.ts`
- Modify: `packages/sdp-env-config/src/fields.ts`
- Modify: `turbo.json`
- Modify: `infra/self-hosted/compose.yml`
- Modify: `apps/sdp-api/src/test/helpers/env.ts`
- Modify: `apps/sdp-api/src/routes/pay/attempts.ts`
- Modify: `apps/sdp-api/src/services/payments/wallet-policy.ts`
- Modify: `apps/sdp-api/src/security/value-moving-conformance.node.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Prove:

- policy denial occurs before `createProjectSponsorshipFeePayment` and
  `signAsFeePayer`;
- concurrent submit retries create one attempt-keyed wallet operation and one
  evaluation per active policy revision;
- prepared attempt is CAS-claimed once;
- exact duplicate bytes replay current state;
- different bytes after claim return `409`;
- sponsor output preserves message/payer signature and adds only fee-payer
  signature;
- strict simulation runs before transfer creation/send;
- deterministic simulation failure marks attempt failed and reopens payment
  only if still payable;
- accepted and ambiguous sends return `202 processing`;
- definitive rejection and ambiguous transport use distinct typed outcomes;
- RPC-returned signature must equal the durable sponsor-derived signature;
- every DB failure rolls back request, attempt, and transfer together;
- cluster mismatch, compute cap, fee/rent cap, and daily project sponsorship
  quota fail before send;
- only one RPC send occurs under concurrent duplicate submit.

- [ ] **Step 2: Add submit body and size limits**

```typescript
z.object({ transaction: boundedBase64WireTransactionSchema }).strict()
```

Reject before decoding if encoded or decoded size exceeds Solana limits.

- [ ] **Step 3: Enforce policy before signer**

Resolve policy context only from the persisted request/project/wallet. Use
`operationFamily: "payment"` and `operationType: "payment_request"` with token,
amount, destination, and payer context. No public field may select tenant,
wallet, project, recipient, token, or amount.

Only submit creates policy state, after loading the already persisted attempt.
Use wallet-operation idempotency key `merchant-pay:${attempt.id}`. Extend the
policy repository with tenant-scoped
`getWalletOperationByIdempotencyKey`, `getWalletOperationForUpdate`, and
`getOrCreateWalletOperation`; on the existing unique-index race, reload and
verify the persisted operation context rather than returning conflict.

Transactionally lock that operation, load its latest evaluation, and insert a
new evaluation only when none exists or the active wallet/API-key policy
revision tuple changed. Concurrent submit retries therefore replay one
operation/evaluation/approval. Assert an allowed, executable decision before
creating the sponsorship adapter or invoking any signer.

- [ ] **Step 4: Add aggregate repository operations**

Implement transaction-aware methods with this fixed lock order:

```text
projects -> payment_requests -> payment_request_attempts
         -> payment_transfers -> merchant_pay_sponsorship_reservations
```

Required operations:

```typescript
claimAttemptForSubmission(input)       // request+attempt CAS, persist payer bytes
reserveSponsorshipBudget(input)        // attempt-unique daily quota reservation
attachProcessingTransfer(input)        // create transfer, link attempt, request->processing
markAttemptSubmitted(input)             // submitting -> submitted with linked transfer guard
settleHostedPayment(input)              // transfer+attempt+request terminal transition
failHostedAttempt(input)                // atomic retryable/expired decision
```

Each method owns one `DbClient` transaction, validates tenant identity and
expected source statuses, and returns a typed conflict/no-op result. Add direct
rollback tests by injecting failure after each constituent write.

- [ ] **Step 5: Claim and persist payer bytes**

Through `claimAttemptForSubmission`:

- CAS `prepared -> submitting`;
- persist hash/full payer-signed bytes;
- ensure request remains `awaiting_payment`;
- reject a competing live attempt.

- [ ] **Step 6: Enforce protocol and sponsorship limits**

Before sponsorship:

- resolve one project-selected `SolanaRpc` for this submit operation and
  require request, recipient custody wallet, RPC genesis hash, and configured
  project cluster to agree;
- reject all compute-budget instructions; the initial builder emits none,
  priority fee is zero, and strict simulation enforces the fixed compute cap;
- estimate the network fee from the exact message and ATA rent only when the
  issued message creates the recipient ATA;
- cap network fee at `100000` lamports, ATA rent at `3000000` lamports, and
  total sponsor liability at their checked sum (all env-overridable downward,
  never upward without a reviewed deployment change);
- reserve estimated lamports against
  `merchantPayDailySponsorshipLamports` through an attempt-unique `0052`
  reservation row under the global lock order.

Replays return the same reservation. Definitive failure/expiry releases it;
accepted or ambiguous submission keeps it charged. Add constants and env
validation for `MERCHANT_PAY_MAX_COMPUTE_UNITS` (default/hard ceiling
`100000`), `MERCHANT_PAY_MAX_NETWORK_FEE_LAMPORTS` (default/hard ceiling
`100000`), and `MERCHANT_PAY_MAX_ATA_RENT_LAMPORTS` (default/hard ceiling
`3000000`). Register all three through API env typing, env-config, Turbo,
self-hosted compose, and test fixtures listed in this task; values may only
reduce the hard ceilings.

- [ ] **Step 7: Sponsor, revalidate, and strictly simulate**

Immediately before `signAsFeePayer`, refetch and validate mint, source, and
destination account owner programs, decimals, extensions, balance,
frozen/paused state, and project-cluster consistency. Call the signer only
after claim, policy, and quota reservation. Decode the result, assert full
signing, verify both signatures and exact message, then call:

```typescript
simulateTransaction(rpc, signedBytes, {
  commitment: "confirmed",
  sigVerify: true,
});
```

Pass this same `rpc` instance to `submitSignedTransaction(signedBytes, rpc)`;
the fee-payment adapter may not fall back to adapter-global RPC configuration.

Reject before send if simulation compute units exceed the fixed approved cap or
if logs indicate unapproved program invocation.

- [ ] **Step 8: Persist recoverable transfer state before send**

Assert fee payer is signer index `0`, payer occupies the exact issued signer
slot, the wallet preserved an empty sponsor slot, and
`getSignatureFromTransaction(fullySigned)` therefore yields the sponsor
signature used as transaction ID. Through `attachProcessingTransfer`:

- create inbound `payment_transfers` row as `processing`;
- save full signed bytes and deterministic signature;
- link attempt/transfer;
- move request `awaiting_payment -> processing`.

- [ ] **Step 9: Submit once and classify outcomes**

Call `feePayment.submitSignedTransaction`. RPC accepted/already-known and
ambiguous transport errors leave request processing and attempt submitted.
Verify any returned signature equals the persisted deterministic signature.
Call guarded `markAttemptSubmitted` for accepted, already-known, or ambiguous
outcomes. Only typed definitive pre-broadcast failures may reopen the request.

- [ ] **Step 10: Register value-moving conformance**

Add Merchant Pay:

- trusted context evidence;
- policy-before-signer marker;
- `claimed_state_machine` replay evidence;
- new signing sink inventory entry.

- [ ] **Step 11: Mount submit route**

```text
POST /pay/:checkoutToken/attempts/:attemptId/submit
```

Return only internal payment ID, `processing`, signature, and server-built
allowlisted return URL.

- [ ] **Step 12: Run tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/submit-attempt.test.ts
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/sponsorship-limits.test.ts
pnpm --filter @sdp/api test -- src/db/repositories/merchant-pay.repository.test.ts
pnpm --filter @sdp/api test -- src/security/value-moving-conformance.node.test.ts
```

Expected: PASS.

- [ ] **Step 13: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 3: Recovery, settlement, and protocol verification

### Task 8: Add hosted attempt recovery and atomic settlement

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay/reconcile-hosted-attempt.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay/reconcile-hosted-attempt.test.ts`
- Modify: `apps/sdp-api/src/services/jobs/track-pending-transfers.ts:38-219`
- Modify: `apps/sdp-api/src/services/jobs/track-pending-transfers.test.ts`
- Modify: `apps/sdp-api/src/db/repositories/merchant-pay.repository.ts`
- Modify: `apps/sdp-api/src/db/repositories/merchant-pay.repository.postgres.ts`

- [ ] **Step 1: Write failing settlement tests**

Cover:

```text
processing + confirmed -> transfer confirmed, attempt confirmed, request paid
paid + finalized -> transfer finalized, request remains paid
processing + chain error -> failed and awaiting_payment if unexpired
processing + chain error after request expiry -> expired
signature absent after validity/recovery window -> dropped
persisted fully signed bytes + valid blockhash + signature absent -> exact rebroadcast
stale submitting + linked transfer -> exact rebroadcast then submitted
ambiguous rebroadcast -> remains processing and retryable
deterministic rebroadcast rejection -> reconcile chain state before transition
confirmed then disappears before finalized -> settlement_review + alert
concurrent job/read reconciliation cannot regress terminal state
```

- [ ] **Step 2: Add transactionally guarded settlement methods**

Use `settleHostedPayment`/`failHostedAttempt` under the aggregate repository's
global lock order. Never settle these rows with independent writes. Add
atomic-rollback injection tests for every intermediate write.

- [ ] **Step 3: Recover stale `submitting`**

For attempts claimed but lacking a transfer:

- reload persisted payer-signed bytes;
- revalidate payment/attempt and blockhash;
- repeat deterministic sponsor signing;
- continue simulation/persist/send;
- expire only after proving blockhash invalid and no signature can land.

Also query stale `submitting` attempts that already have a linked processing
transfer. Those have durable fully signed bytes but may have crashed before
send or before `markAttemptSubmitted`; process them through the exact-byte
rebroadcast path below, then guardedly advance to `submitted`.

- [ ] **Step 4: Rebroadcast persisted fully signed transfers**

For a processing transfer whose deterministic signature is absent on chain:

1. load its immutable fully signed bytes;
2. resolve the current project-selected RPC target and verify its genesis hash;
3. while current block height is at or below `last_valid_block_height`,
   rebroadcast those exact bytes through `submitSignedTransaction`;
4. pass that same RPC instance to status, rebroadcast, and historical lookup;
5. treat accepted, already-known, and ambiguous transport as processing;
6. never rebuild or re-sign a transfer that already has signed bytes;
7. after expiry, query signature status with transaction-history search through
   the project provider's configured failover before considering it dropped.

Only call `failHostedAttempt` after both blockhash invalidity and historical
signature absence are proven. A deterministic rebroadcast error alone is not
proof that the first send failed.

- [ ] **Step 5: Extend pending-transfer tracking**

Join processing transfers to hosted attempts. Use bounded batches, guarded
claims, project fairness, existing RPC failover/error handling, and no
confirmation waits in request handlers.

- [ ] **Step 6: Monitor confirmed until finalized**

Add a bounded query for confirmed Merchant Pay transfers linked to paid
requests. A rollback moves the request to `settlement_review`; it never becomes
payable again automatically.

- [ ] **Step 7: Add best-effort targeted refresh**

Authenticated get-by-ID may refresh one known active signature for lower poll
latency. Background reconciliation remains authoritative.

- [ ] **Step 8: Run recovery tests**

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay/reconcile-hosted-attempt.test.ts
pnpm --filter @sdp/api test -- src/services/jobs/track-pending-transfers.test.ts
```

Expected: PASS.

- [ ] **Step 9: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 9: Document public protocol schemas and errors

**Files:**
- Modify: `apps/sdp-api/src/openapi/schemas/payments.ts`
- Modify: `apps/sdp-api/src/openapi/paths/payments.ts` or add a focused public-pay path registrar
- Modify: `apps/sdp-api/src/openapi/spec.ts`
- Modify: `apps/sdp-api/src/openapi/spec.test.ts`
- Generate: `apps/sdp-api/generated/openapi.json`

- [ ] **Step 1: Write failing OpenAPI assertions**

Assert schemas/operations for public checkout summary, prepare, and submit,
including stable errors:

```text
ATTEMPT_EXPIRED
INVALID_SIGNATURE
TRANSACTION_MISMATCH
TRANSACTION_SIMULATION_FAILED
PAYMENT_ALREADY_PROCESSING
```

- [ ] **Step 2: Register public route schemas**

Document that prepare returns a payer-signable transaction with an empty
sponsor signature slot, and submit accepts payer-signed bytes and returns
`202`.

- [ ] **Step 3: Regenerate and test**

```bash
pnpm -C apps/sdp-api openapi:generate
pnpm --filter @sdp/api test -- src/openapi/spec.test.ts
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 10: Verify the complete backend protocol

**Files:**
- Create: `apps/sdp-api/src/routes/merchant-pay.local-validator.node.test.ts`
- Create: `apps/sdp-api/src/test/helpers/merchant-pay-fault-rpc.ts`
- Create: `apps/sdp-api/src/security/merchant-pay-secrecy.node.test.ts`
- Create or modify only other focused integration fixtures/tests needed for Merchant Pay

- [ ] **Step 1: Add API-level concurrency and crash-boundary tests**

Exercise duplicate create/prepare/submit, two payers, cancel-versus-submit,
expiry-versus-submit, crash after every DB/signer/RPC boundary, timeout after
send, exact policy replay, deterministic-versus-ambiguous send
classification, exact-byte rebroadcast, returned-signature mismatch, and
atomic rollback. Add property-based or deterministic mutation/fuzz coverage
for message bytes, signatures, instruction accounts, amount, mint, blockhash,
version, and encoded/decoded size bounds. Capture logs and prove checkout
tokens, signed transaction bytes, payer/sponsor signature material, private
keys, and opaque merchant metadata are absent. The public deterministic
transaction signature is intentionally permitted as the spec's correlation
identifier.

Add a test-only injected RPC wrapper controlled by
`MERCHANT_PAY_FAULT_SCENARIOS` with exact supported values
`insufficient_funds`, `blockhash_expiry`, `timeout_after_send`,
`duplicate_submit`, `cancel_submit_race`, and `confirmed_rollback`. It may
delay/fail/status-script only the local-validator fixture; production RPC
construction must not read this variable.

- [ ] **Step 2: Add end-to-end local-validator tests**

For SOL and supported SPL:

1. create hosted request;
2. prepare;
3. payer-sign without sponsor signature;
4. prove direct RPC submission of those payer-only bytes is rejected because
   the fee-payer signature is absent;
5. submit through SDP;
6. reconcile confirmed;
7. assert recipient balance and paid request.

Also test insufficient funds, ATA creation, blockhash expiry, and rejected
Token-2022 extension cases.

Run a dedicated validator in one terminal:

```bash
solana-test-validator --reset --ledger .local/merchant-pay-validator --rpc-port 8899
```

Run the fixture in another:

```bash
MERCHANT_PAY_LOCAL_VALIDATOR=1 \
SOLANA_RPC_URL=http://127.0.0.1:8899 \
SOLANA_NETWORK=devnet \
pnpm --filter @sdp/api test:serial -- src/routes/merchant-pay.local-validator.node.test.ts
```

The test generates payer/sponsor keys, airdrops funds, configures matching
logical project cluster fixtures, and creates its SPL mint/accounts itself.

- [ ] **Step 3: Run focused verification**

```bash
pnpm --filter @sdp/payments test
pnpm --filter @sdp/api test -- src/services/adapters/fee-payment
pnpm --filter @sdp/api test -- merchant-pay
pnpm --filter @sdp/api test -- track-pending-transfers
pnpm --filter @sdp/api test -- value-moving-conformance
pnpm --filter @sdp/api test -- src/security/merchant-pay-secrecy.node.test.ts
pnpm --filter @sdp/api typecheck
pnpm check:module-boundaries
```

- [ ] **Step 4: Run API regression**

```bash
pnpm --filter @sdp/api test
pnpm typecheck
```

- [ ] **Step 5: Confirm Phase 2 acceptance**

- hosted prepare never emits a sponsor signature;
- wallet-signed bytes cannot be broadcast successfully without SDP;
- SDP accepts only the issued message and expected payer;
- policy runs before signer creation/invocation;
- fee/compute/rent/cluster/quota limits hold before send;
- deterministic signature is durable before send;
- ambiguous send and crash-before-send are recoverable by exact-byte rebroadcast;
- paid is reached only at confirmed and monitored until finalized;
- legacy `solana_pay` behavior remains isolated and working.

- [ ] **Step 6: Checkpoint**

Phase 2 is ready for review. Do not create a git commit unless the user
explicitly authorizes commits.
