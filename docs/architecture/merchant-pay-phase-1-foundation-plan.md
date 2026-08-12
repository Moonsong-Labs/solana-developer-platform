# Merchant Pay Phase 1 Foundation Implementation Plan

> **For Claude:** REQUIRED: Use core-engineering:subagent-driven-development (if subagents available) or core-engineering:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable Merchant Pay data model and authenticated merchant APIs for idempotent create, get-by-ID polling, and cancellation without changing on-chain execution.

**Architecture:** Extend the existing `payment_requests` aggregate and add a separate `payment_request_attempts` repository. Hosted requests use project-scoped merchant order IDs, a dedicated HMAC-derived checkout token stored only as a hash, and allowlisted return origins in project settings. Legacy Solana Pay requests remain backward compatible.

**Tech Stack:** TypeScript, Hono, Zod, raw PostgreSQL migrations/repositories, `@sdp/types`, `@sdp/payments/hash`, Vitest/Testcontainers, OpenAPI generation.

**Depends on:** Approved architecture at `docs/architecture/merchant-pay-system.md`.

**Out of scope:** Public prepare/submit, transaction signing, RPC submission, reconciliation changes, wallet UI, and merchant settlement webhooks.

**Test prerequisites:** Repository/API tests require the repository's normal
Postgres and Redis test services plus migrated test schema. Use the existing
local test bootstrap; do not point tests at a shared or production database.

---

## Chunk 1: Persistence and domain contracts

### Task 1: Extend the Payment Request schema

**Files:**
- Create: `apps/sdp-api/src/db/migrations/postgres/0050_merchant_pay_payment_requests.sql`
- Create: `apps/sdp-api/src/db/migrations/postgres/merchant-pay-schema.test.ts`
- Modify: `apps/sdp-api/src/test/mocks/db.ts`

- [ ] **Step 1: Write failing migration/schema expectations**

Use direct Postgres catalog/insert assertions proving:

```typescript
expect(row.checkout_mode).toBe("hosted");
expect(row.merchant_order_id).toBe("order_8742");
expect(row.metadata).toEqual({ cartVersion: "3" });
expect(row.return_url).toBe("https://merchant.example/checkout/complete");
expect(row.checkout_token_hash).toMatch(/^[a-f0-9]{64}$/);
expect(row.checkout_token_version).toBe(1);
expect(row.idempotency_key).toBe("idem-order-8742");
expect(row.request_fingerprint).toHaveLength(64);
```

Also test project-scoped uniqueness for `merchant_order_id` and
`idempotency_key`, hosted-field requirements, metadata object enforcement, and
acceptance of `processing`/`settlement_review`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @sdp/api test -- src/db/migrations/postgres/merchant-pay-schema.test.ts
```

Expected: FAIL because the columns and input fields do not exist.

- [ ] **Step 3: Add migration `0050`**

The migration must:

```sql
ALTER TABLE payment_requests
    ADD COLUMN checkout_mode TEXT NOT NULL DEFAULT 'solana_pay',
    ADD COLUMN merchant_order_id TEXT,
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN return_url TEXT,
    ADD COLUMN checkout_token_hash TEXT,
    ADD COLUMN checkout_token_version INTEGER,
    ADD COLUMN idempotency_key TEXT,
    ADD COLUMN request_fingerprint TEXT;
```

Then:

- replace the status check with
  `awaiting_payment|processing|paid|canceled|expired|settlement_review`;
- constrain checkout mode to `hosted|solana_pay`;
- require metadata to be a JSON object;
- require hosted rows to have merchant order, return URL, checkout-token hash
  and positive token version, idempotency key, and request fingerprint;
- bound `merchant_order_id` and `idempotency_key` lengths and require both hash
  fields to be 64 lowercase hex characters;
- add partial unique indexes for project-scoped merchant order and idempotency
  key;
- add a unique partial index for `checkout_token_hash`;
- preserve all existing rows as `solana_pay`.

- [ ] **Step 4: Update test cleanup ordering**

Add `payment_request_attempts` later in Task 2. For now ensure
`payment_requests` remains before `payment_transfers` because Payment Requests
reference transfers. In Task 2, insert `payment_request_attempts` immediately
before `payment_requests`, producing the delete order attempts -> requests ->
transfers.

- [ ] **Step 5: Apply migrations and rerun the test**

Run:

```bash
pnpm --filter @sdp/api db:migrate:test
pnpm --filter @sdp/api test -- src/db/migrations/postgres/merchant-pay-schema.test.ts
```

Expected: PASS. This task reaches green without depending on repository
mappings added later.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 2: Add Payment Request Attempts persistence

**Files:**
- Create: `apps/sdp-api/src/db/migrations/postgres/0051_payment_request_attempts.sql`
- Create: `apps/sdp-api/src/db/repositories/payment-request-attempts.repository.ts`
- Create: `apps/sdp-api/src/db/repositories/payment-request-attempts.repository.postgres.ts`
- Create: `apps/sdp-api/src/db/repositories/payment-request-attempts.repository.test.ts`
- Modify: `apps/sdp-api/src/db/repositories/repository-factory.ts`
- Modify: `apps/sdp-api/src/db/repositories/index.ts`
- Modify: `apps/sdp-api/src/test/mocks/db.ts`

- [ ] **Step 1: Write failing attempt-repository tests**

Cover:

- `patt_` ID generation;
- create/read/list scoped by organization and project;
- one live attempt across `prepared|submitting|submitted`;
- same request can have a later attempt after terminal
  `confirmed|failed|dropped|expired`;
- unique transaction signature;
- immutable payer/message/blockhash/template fields;
- compare-and-set transition methods;
- stale `submitting` lookup for Phase 2 recovery.

Core test shape:

```typescript
const attempt = await repo.createAttempt({
  paymentRequestId,
  payerAddress,
  status: "prepared",
  transactionVersion: 0,
  messageHash,
  unsignedTx,
  feePayerAddress,
  blockhash,
  lastValidBlockHeight,
  expiresAt,
});
expect(attempt.id).toMatch(/^patt_/);
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
pnpm --filter @sdp/api test -- src/db/repositories/payment-request-attempts.repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Add migration `0051`**

Create `payment_request_attempts` with the architecture fields:

```text
id, payment_request_id, organization_id, project_id, payer_address, status,
transaction_version, message_hash, unsigned_tx, payer_signed_tx, signed_tx,
fee_payer_address, fee_payer_signature, transaction_signature, blockhash,
last_valid_block_height, expires_at, transfer_id, error_code, error,
created_at, updated_at, submitted_at, confirmed_at
```

Add tenant-consistent foreign keys, status and transaction-version checks,
signature uniqueness, lookup/recovery indexes, and:

```sql
CREATE UNIQUE INDEX ... ON payment_request_attempts(payment_request_id)
WHERE status IN ('prepared', 'submitting', 'submitted');
```

- [ ] **Step 4: Implement the repository interface**

Expose focused methods rather than generic updates:

```typescript
createAttempt(input)
getAttemptById(input)
getLatestAttemptForRequest(input)
getLiveAttemptForRequest(input)
listAttemptsForRequest(input)
claimAttemptForSubmit(input)          // prepared -> submitting CAS
markAttemptFailed(input)               // attempt-only guarded transition
markAttemptExpired(input)              // attempt-only guarded transition
listStaleSubmittingAttempts(input)
```

Updates must guard expected source status and may not change immutable fields.
Cross-aggregate transfer attachment and settlement methods are deliberately
deferred to Phase 2, where they are designed against one transaction client.

- [ ] **Step 5: Implement the Postgres repository**

Copy raw-SQL mapping and tenant patterns from:

- `payment-requests.repository.postgres.ts`;
- recurring-payment activation/lifecycle attempt methods;
- subscription collection-attempt repository methods.

Translate PostgreSQL unique violations into deterministic conflict errors at
the service/handler boundary, not generic `500`. Enforce immutability in the
database with a trigger rejecting updates to payer, message hash, unsigned
transaction, fee payer, blockhash, lifetime, and request/tenant identity; test
the trigger with direct SQL as well as repository methods.

- [ ] **Step 6: Register factories and cleanup**

- export attempt types/repository from `db/repositories/index.ts`;
- add tenant-bound `createPaymentRequestAttemptsRepository`;
- add a system factory only for reconciliation work;
- delete `payment_request_attempts` before `payment_requests` in test cleanup.

- [ ] **Step 7: Run repository and tenant-boundary tests**

Run:

```bash
pnpm --filter @sdp/api test -- src/db/repositories/payment-request-attempts.repository.test.ts
pnpm --filter @sdp/api test -- src/lib/tenant-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 3: Extend shared Payment Request types

**Files:**
- Modify: `packages/sdp-types/src/payments.ts:506-539`
- Modify: `packages/sdp-types/src/projects.ts:20-54`
- Create: `packages/sdp-types/src/payments.contract.test.ts`

- [ ] **Step 1: Add the compile-time contract fixture**

Exercise:

```typescript
const request: PaymentRequest = {
  // existing fields
  checkoutMode: "hosted",
  merchantOrderId: "order_8742",
  metadata: { cartVersion: "3" },
  returnUrl: "https://merchant.example/checkout/complete",
  checkoutUrl: "https://dashboard.example/pay/opaque",
  latestAttempt: null,
  transfer: null,
};
```

Statuses include `processing` and `settlement_review`.

- [ ] **Step 2: Extend types**

Add:

- `PaymentRequestCheckoutMode`;
- extended `PaymentRequestStatus`;
- `PaymentRequestAttemptStatus`;
- `PaymentRequestAttemptSummary`;
- create/get/cancel/list response types;
- `merchantPayReturnOrigins?: string[]` and
  `merchantPayAllowedMints?: string[]` and
  `merchantPayDailySponsorshipLamports?: string` and
  `merchantPayEnabled?: boolean` in project settings.

Keep list and detail contracts distinct: list must not expose metadata,
`returnUrl`, or checkout credentials.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @sdp/types typecheck
```

Expected: shared package PASS. Run API typecheck after repository/handler
mappings are updated in Tasks 4 and 8.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 4: Extend the Payment Requests repository

**Files:**
- Modify: `apps/sdp-api/src/db/repositories/payment-requests.repository.ts:22-87`
- Modify: `apps/sdp-api/src/db/repositories/payment-requests.repository.postgres.ts:18-180`
- Modify: `apps/sdp-api/src/db/repositories/payment-requests.repository.test.ts`

- [ ] **Step 1: Add failing tests for new methods**

Test:

```text
findByIdempotencyKey
findByMerchantOrderId
getByCheckoutTokenHash
getPaymentRequestForUpdate
cancelAwaitingRequest
```

Every mutation must use expected source states and reject terminal regression.
Processing/paid/settlement-review transitions are deferred to Phase 2's atomic
attempt/transfer/request orchestration.

`getPaymentRequestForUpdate` must issue a tenant-scoped
`SELECT ... FROM payment_requests ... FOR UPDATE` on the caller's transaction
client. It is not exposed from a non-transactional repository factory.

- [ ] **Step 2: Extend row/input mappings**

Add all `0050` columns to `PaymentRequestRow` and
`CreatePaymentRequestInput`. Keep public token/reference generation for legacy
rows.

- [ ] **Step 3: Implement guarded methods**

Use explicit SQL transitions, for example:

```sql
UPDATE payment_requests
SET status = 'canceled',
    canceled_by = ?,
    updated_at = sdp_iso_now()
WHERE id = ?
  AND organization_id = ?
  AND project_id = ?
  AND status = 'awaiting_payment'
  AND (expires_at IS NULL OR expires_at > sdp_iso_now())
RETURNING *;
```

Do not broaden the existing `markPaymentRequest` into an unguarded generic
status writer.

- [ ] **Step 4: Implement idempotency race lookup**

Use `(organization_id, project_id, idempotency_key)` and compare the persisted
fingerprint. Same key/same fingerprint replays; same key/different fingerprint
returns conflict.

- [ ] **Step 5: Run repository tests**

Run:

```bash
pnpm --filter @sdp/api test -- src/db/repositories/payment-requests.repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 2: Merchant security plumbing and authenticated APIs

### Task 5: Add checkout-token key plumbing and service

**Files:**
- Modify: `apps/sdp-api/src/types/env.d.ts`
- Modify: `packages/sdp-env-config/src/fields.ts`
- Modify: `packages/sdp-env-config/src/secrets.test.ts`
- Modify: `scripts/secret-keys.mjs`
- Modify: `turbo.json`
- Modify: `infra/self-hosted/compose.yml`
- Modify: `apps/sdp-api/src/test/helpers/env.ts`
- Create: `apps/sdp-api/src/services/payments/checkout-token.service.ts`
- Create: `apps/sdp-api/src/services/payments/checkout-token.service.test.ts`

- [ ] **Step 1: Write failing token-service tests**

Lock the wire behavior:

- output is opaque URL-safe text and contains no `preq_` ID;
- same request ID/version/key produces the same token;
- incrementing version changes token;
- database lookup hash is deterministic;
- verification uses constant-time digest comparison;
- missing/short key fails closed;
- token generation works for idempotent create replay.

- [ ] **Step 2: Register a dedicated secret**

Add `MERCHANT_PAY_CHECKOUT_TOKEN_KEY` to API env typing and env-config secret
inventory, deployment pass-through, Turbo env declaration, self-hosted compose,
and test env fixture. Do not reuse API-key pepper, Clerk, or webhook secrets.

- [ ] **Step 3: Implement the token service**

Use Web Crypto HMAC-SHA-256 or the established `@sdp/payments/hash` helper.
Derive opaque token bytes from:

```text
"merchant-pay:v1" || paymentRequestId || checkoutTokenVersion
```

Then hash the full wire token for indexed lookup. Store no raw bearer token.
Build checkout URLs from validated `FRONTEND_URL`; do not derive them from
request headers. Fail closed when the configured frontend URL is absent or not
HTTP(S).

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @sdp/env-config test
pnpm --filter @sdp/api test -- src/services/payments/checkout-token.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 6: Add Merchant Pay project settings and return-origin validation

**Files:**
- Modify: `apps/sdp-api/src/routes/projects/schemas.ts:6-18`
- Modify: `apps/sdp-api/src/openapi/schemas/projects.ts:19-46`
- Modify: `apps/sdp-api/src/services/project.service.ts:182-193,441-467`
- Modify: `apps/sdp-api/src/routes/projects.test.ts`
- Modify: `apps/sdp-api/src/services/project.service.test.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-return-origin.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-return-origin.test.ts`
- Modify: relevant project route/service tests

- [ ] **Step 1: Write failing URL security tests**

Cover:

```text
exact HTTPS origin match
effective port normalization
path/query allowed after origin match
userinfo rejected
non-http schemes rejected
lookalike and suffix domains rejected
production localhost rejected
sandbox localhost accepted only when explicitly allowlisted
reserved callback query keys replaced by server values
```

- [ ] **Step 2: Extend project settings**

Add `merchantPayReturnOrigins`, `merchantPayAllowedMints`,
`merchantPayDailySponsorshipLamports`, and `merchantPayEnabled` to project
settings validation and OpenAPI. Normalize each configured return value to an
origin, validate each mint as a Solana address for the project cluster,
deduplicate both lists, validate the sponsorship quota as a canonical
non-negative integer string, and default eligibility to `false` before
persistence.

Absent-value semantics are fail-closed and must be shared by service, schema,
OpenAPI examples, and tests:

```text
merchantPayReturnOrigins missing -> []
merchantPayAllowedMints missing -> [] (SOL only; no SPL mint allowed)
merchantPayDailySponsorshipLamports missing or "0" -> sponsorship disabled
merchantPayEnabled missing -> false
```

Hosted create requires enabled project eligibility, at least one valid return
origin, and a positive sponsorship quota. SPL create additionally requires the
mint in the allowlist.

- [ ] **Step 3: Implement return URL validation**

Expose:

```typescript
normalizeMerchantPayOrigin(url)
validateMerchantPayReturnUrl({ returnUrl, allowedOrigins, environment })
appendMerchantPayCallback({ returnUrl, paymentId, status })
```

Never accept a return URL from the public submit request.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay-return-origin.test.ts
pnpm --filter @sdp/api test -- src/services/project.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 7: Add hosted create fingerprinting and request schemas

**Files:**
- Modify: `apps/sdp-api/src/lib/idempotency.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-constraints.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-availability.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-availability.test.ts`
- Create: `apps/sdp-api/src/services/payments/validate-merchant-pay-asset.ts`
- Create: `apps/sdp-api/src/services/payments/validate-merchant-pay-asset.test.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-cluster.ts`
- Create: `apps/sdp-api/src/services/payments/payment-request-idempotency.test.ts`
- Modify: `apps/sdp-api/src/routes/payments/schemas.ts`
- Modify: `apps/sdp-api/src/routes/payments/schemas.test.ts`
- Modify: `apps/sdp-api/src/types/env.d.ts`
- Modify: `packages/sdp-env-config/src/fields.ts`
- Modify: `scripts/secret-keys.mjs`
- Modify: `turbo.json`
- Modify: `infra/self-hosted/compose.yml`
- Modify: `apps/sdp-api/src/test/helpers/env.ts`

- [ ] **Step 1: Write failing canonicalization tests**

The fingerprint includes:

```text
walletId, token, canonical decimal amount, merchantOrderId, canonical metadata,
normalized returnUrl, expiresAt, checkoutMode, project/organization scope
```

Metadata limits:

- at most 4 KiB UTF-8 after canonical JSON encoding;
- depth at most 3;
- at most 32 keys total;
- key length at most 64;
- string value length at most 512;
- no `undefined`, functions, non-finite numbers, or prototype keys.

Use these exact request limits:

```typescript
const MERCHANT_ORDER_ID_MAX_LENGTH = 128;
const MERCHANT_ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const DEFAULT_MAX_CHECKOUT_LIFETIME_SECONDS = 1800;
const HARD_MAX_CHECKOUT_LIFETIME_SECONDS = 86400;
```

Register `MERCHANT_PAY_MAX_CHECKOUT_LIFETIME_SECONDS` and deployment gate
`MERCHANT_PAY_ENABLED` through API env typing, env-config,
`scripts/secret-keys.mjs` (the local/self-hosted API env projection), Turbo,
self-hosted compose, and test fixtures. Accept lifetime `60..86400`, default it
to `1800`, and default the deployment gate to `false`. Also test expiry
strictly in the future, cluster token allowlisting, supported Token/Token-2022
program checks, and exact decimal representability at mint decimals.

- [ ] **Step 2: Add hosted request Zod schemas**

Hosted mode requires `merchantOrderId`, `returnUrl`, future `expiresAt`, and
`Idempotency-Key`. Legacy/default `solana_pay` remains compatible with the
existing body.

`merchant-pay-availability.ts` permits hosted create only when deployment
`MERCHANT_PAY_ENABLED` and project `merchantPayEnabled` are both true. Disabled
gates return a stable unavailable error for new hosted creation; public summary,
authenticated reads, cancellation, and legacy Solana Pay remain available.

- [ ] **Step 3: Implement fingerprint helper**

Add explicit reusable constants/schemas in `merchant-pay-constraints.ts`.
Canonicalize with existing normalization, then SHA-256 the canonical UTF-8
JSON; `request_fingerprint` is the 64-character lowercase hex digest, not the
canonical JSON itself:

```typescript
buildPaymentRequestFingerprint({ scope: "payment_request", ...resolvedInput })
```

Implement asset validation through the existing project read service and
`@sdp/rpc/solana.createRpc`:

1. load the authenticated project and its settings from PostgreSQL;
2. map `sandbox -> devnet` and `production -> mainnet-beta`; call
   `getGenesisHash` through the selected project RPC and compare against
   explicit canonical genesis-hash constants before trusting mint data;
3. accept SOL intrinsically; require every mint address in
   `merchantPayAllowedMints`;
4. fetch the mint from that project's RPC and require the legacy Token Program
   or Token-2022 owner;
5. decode decimals from chain data and require exact base-unit
   representability;
6. for initial Token-2022 support, require no mint extensions; unknown,
   transfer-fee, transfer-hook, confidential-transfer, pausable/default-frozen,
   permanent-delegate, and non-transferable extensions fail closed.

Phase 2 reuses the same validator and additionally checks payer/source/
destination token-account state immediately before sponsorship.
The local-validator test fixture may dependency-inject its runtime genesis hash
into this service; production handlers cannot override canonical hashes.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @sdp/api test -- src/services/payments/payment-request-idempotency.test.ts
pnpm --filter @sdp/api test -- src/services/payments/merchant-pay-availability.test.ts
pnpm --filter @sdp/api test -- src/services/payments/validate-merchant-pay-asset.test.ts
pnpm --filter @sdp/api test -- src/routes/payments/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 8: Implement authenticated create, get, and cancel

**Files:**
- Modify: `apps/sdp-api/src/routes/payments/handlers/payment-requests.ts:20-140`
- Create: `apps/sdp-api/src/routes/payments/handlers/payment-requests.test.ts`
- Modify: `apps/sdp-api/src/routes/payments/handlers.ts`
- Modify: `apps/sdp-api/src/routes/payments/index.ts:203-209`
- Modify: `apps/sdp-api/src/services/payments/payment-requests.ts:23-70`
- Modify: `apps/sdp-api/src/routes/pay.ts`
- Modify: `apps/sdp-api/src/routes/payments.test.ts`

- [ ] **Step 1: Write failing handler tests**

Test:

- hosted create requires project API auth, `payments:write`, wallet access,
  deployment/project Merchant Pay gates, merchant order, allowed return URL,
  expiry, and idempotency key;
- same key/same fingerprint returns the original payment and checkout URL;
- conflicting key or merchant order returns `409`;
- get-by-ID is tenant/project/wallet scoped and returns attempt/transfer
  summaries but never a checkout token;
- cancel is idempotent;
- cancel expires a merely `prepared` attempt in the same transaction;
- cancel rejects `submitting|submitted|processing|paid`;
- hosted rows skip legacy `findReference` reconciliation;
- hosted public summary resolves by checkout-token hash;
- hosted public summary omits internal payment ID, merchant order ID, metadata,
  return URL, legacy public token, raw/hash checkout credentials, idempotency
  data, and request fingerprint;
- legacy `GET/POST /pay/:token/tx` rejects hosted mode before sponsorship;
- legacy create/list behavior remains intact.

- [ ] **Step 2: Refactor mapping into list and detail mappers**

List mapper omits metadata, return URL, and attempt details. Detail mapper may
return merchant-owned metadata and return URL to authenticated callers.

- [ ] **Step 3: Implement idempotent hosted create**

Order:

1. validate auth/project/body/header and both Merchant Pay gates;
2. resolve wallet and API-key wallet scope;
3. validate token/amount and project return-origin allowlist;
4. canonicalize metadata and fingerprint;
5. replay existing idempotency row if present;
6. generate request ID/reference/public legacy token;
7. derive checkout token version/hash and insert;
8. on unique race, replay and compare fingerprint;
9. return internal ID and reproducible checkout URL.

Hosted token generation/lookup must make `GET /pay/:checkoutToken` resolve a
payer-safe summary in Phase 1. The hosted checkout cannot execute until Phase
2/3, but the URL must not 404 or fall through to legacy public-token lookup.

- [ ] **Step 4: Implement get-by-ID**

Use the request repository plus latest attempt/linked transfer reads. Set
`Retry-After` while status is `processing`.

- [ ] **Step 5: Implement cancel transactionally**

Use `getDb(c.env).transaction`, `asTransactionalClient`, and repositories bound
to that transaction. First call tenant-scoped
`getPaymentRequestForUpdate`, which executes `SELECT ... FOR UPDATE`; only then
lock/read the live attempt with its repository. Reject wall-clock-expired
requests. Expire only a `prepared` attempt and move `awaiting_payment ->
canceled` in the same transaction. A concurrent `submitting`/`submitted` claim
wins and cancellation returns conflict.

- [ ] **Step 6: Register routes**

```text
GET  /v1/payments/requests/:paymentRequestId
POST /v1/payments/requests/:paymentRequestId/cancel
```

Use existing payment read/write permissions and wallet scoping.

- [ ] **Step 7: Run handler and regression tests**

Run:

```bash
pnpm --filter @sdp/api test -- src/routes/payments/handlers/payment-requests.test.ts
pnpm --filter @sdp/api test -- src/services/payments/payment-requests.test.ts
pnpm --filter @sdp/api test -- src/routes/payments.test.ts
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 3: Public contract and phase verification

### Task 9: Publish Payment Request OpenAPI contracts

**Files:**
- Modify: `apps/sdp-api/src/openapi/schemas/payments.ts`
- Modify: `apps/sdp-api/src/openapi/paths/payments.ts`
- Modify: `apps/sdp-api/src/openapi/paths/responses.ts`
- Modify: `apps/sdp-api/src/openapi/schemas/projects.ts`
- Modify: `apps/sdp-api/src/openapi/spec.test.ts`
- Generate: `apps/sdp-api/generated/openapi.json`
- Generate: `apps/sdp-web/src/lib/api-playground-catalog.generated.json`

- [ ] **Step 1: Add failing OpenAPI assertions**

Assert operation IDs and schemas for:

```text
listPaymentRequests
createPaymentRequest
getPaymentRequest
cancelPaymentRequest
```

Create must document project scope plus `Idempotency-Key`; project settings
must document `merchantPayReturnOrigins`, `merchantPayAllowedMints`,
`merchantPayDailySponsorshipLamports`, and `merchantPayEnabled`.

- [ ] **Step 2: Add schemas and path registrations**

Reuse handler Zod bases. Document hosted/legacy conditional requirements,
status values, safe detail response, `409` replay conflicts, and `Retry-After`.

- [ ] **Step 3: Regenerate OpenAPI**

Run:

```bash
pnpm -C apps/sdp-api openapi:generate
pnpm generate:api-playground
pnpm --filter @sdp/api test -- src/openapi/spec.test.ts
```

Expected: generated JSON includes all four payment-request operations and
tests pass.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 10: Verify Phase 1 as an independently usable merchant API foundation

**Files:**
- Modify only files needed to fix failures introduced by this phase

- [ ] **Step 1: Run focused checks**

```bash
pnpm --filter @sdp/api test -- src/db/repositories/payment-requests.repository.test.ts
pnpm --filter @sdp/api test -- src/db/repositories/payment-request-attempts.repository.test.ts
pnpm --filter @sdp/api test -- src/routes/payments/handlers/payment-requests.test.ts
pnpm --filter @sdp/api typecheck
```

- [ ] **Step 2: Run architecture checks**

```bash
pnpm check:module-boundaries
pnpm check:api-playground
```

- [ ] **Step 3: Run API regression**

```bash
pnpm --filter @sdp/api test
pnpm typecheck
```

- [ ] **Step 4: Confirm acceptance**

Manually verify:

- hosted create is idempotent and returns the same internal ID/checkout URL;
- merchant order maps uniquely to the SDP payment;
- authenticated detail polling works;
- cancellation cannot race past claimed submission;
- hosted checkout URL resolves a safe summary, but no public prepare/submit
  behavior exists yet;
- legacy Solana Pay tests remain unchanged.

- [ ] **Step 5: Checkpoint**

Phase 1 is ready for review. Do not create a git commit unless the user
explicitly authorizes commits.
