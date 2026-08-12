# Merchant Pay Phase 3 Hosted Checkout Implementation Plan

> **For Claude:** REQUIRED: Use core-engineering:subagent-driven-development (if subagents available) or core-engineering:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the SDP-hosted wallet checkout, merchant dashboard configuration, public documentation, and sandbox rollout verification on top of the Phase 1–2 backend.

**Architecture:** The existing `/pay/[token]` route branches on persisted checkout mode. Hosted mode discovers Wallet Standard wallets, prepares one SDP transaction attempt, calls `signTransaction` only, submits payer-signed bytes to SDP, and immediately redirects to the server-provided allowlisted merchant return URL after `202`. Legacy mode keeps its QR/deep-link flow.

**Tech Stack:** Next.js/React, Wallet Standard, `@solana/kit`, SDP design-system tokens/components, Vitest/Testing Library, Playwright, Hono public APIs, generated OpenAPI/docs.

**Depends on:**
- `docs/architecture/merchant-pay-phase-1-foundation-plan.md`
- `docs/architecture/merchant-pay-phase-2-transaction-protocol-plan.md`

**Hard preflight gate:** Do not begin Phase 3 until both prerequisite plans are
merged and their acceptance checklists are green. Verify migrations `0050`,
`0051`, and `0052`; authenticated create/get/cancel; public summary,
prepare, and submit contracts; submit-only fee-payment behavior; aggregate
repository transitions; exact-byte rebroadcast; confirmed/finalized
reconciliation; OpenAPI generation; API tests/typecheck; module boundaries;
and the Phase 2 local-validator SOL/SPL fixture. Record the passing command
output in the implementation handoff before changing web code.

**Required UI guidance:** Read and follow
`.claude/skills/sdp-ui-designer/SKILL.md` and its bundled `AGENTS.md` before
editing UI.

**Out of scope:** Merchant settlement webhooks, refunds, partial payments,
custom branding themes, arbitrary wallets without Wallet Standard transaction
signing, and iframe embedding.

---

## Chunk 1: Wallet Standard client foundation

### Task 1: Add minimal wallet dependencies

**Files:**
- Modify via pnpm: `apps/sdp-web/package.json`
- Generate via pnpm: `pnpm-lock.yaml`

- [ ] **Step 1: Confirm current dependency state**

Verify `sdp-web` has no wallet adapter/Wallet Standard runtime dependency and
that `@solana/kit` is currently dev-only.

- [ ] **Step 2: Install runtime packages with pnpm**

Run:

```bash
pnpm --filter sdp-web add @wallet-standard/app @wallet-standard/features @solana/wallet-standard-features
pnpm --filter sdp-web add @solana/kit@catalog:
```

Use the package manager's current compatible releases; do not add
`@solana/web3.js` or `@solana/wallet-adapter-*`. Do not edit `Cargo.toml` or
`go.mod`.

- [ ] **Step 3: Inspect lockfile resolution**

Ensure one compatible Solana Kit family is used by the web app. Avoid direct
imports from separately versioned Solana subpackages when Kit re-exports the
required API.

- [ ] **Step 4: Run dependency/type checks**

```bash
pnpm --filter sdp-web typecheck
pnpm check:module-boundaries
```

Expected: PASS without branded-type conflicts.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 2: Implement Wallet Standard discovery and capability filtering

**Files:**
- Create: `apps/sdp-web/src/app/pay/[token]/wallet-standard-client.ts`
- Create: `apps/sdp-web/src/app/pay/[token]/wallet-standard-client.unit.test.ts`

- [ ] **Step 1: Write failing wallet-capability tests**

Create fake Wallet Standard wallets and prove:

- only Solana wallets supporting connect plus transaction signing are shown;
- wallets exposing send-only behavior are not used;
- `mainnet-beta` maps to `solana:mainnet` and `devnet` maps to
  `solana:devnet`;
- wallet and selected account both advertise the mapped chain and required
  features;
- account changes/disconnect invalidate the prepared attempt in client state;
- `standard:disconnect` is invoked only when advertised;
- subscriptions are disposed on unmount;
- wallet/provider errors are normalized without exposing raw objects.

- [ ] **Step 2: Implement discovery**

Use `getWallets()` from `@wallet-standard/app` and features from
`@wallet-standard/features` /
`@solana/wallet-standard-features`. Expose a small app-owned interface:

```typescript
interface HostedCheckoutWallet {
  id: string;
  name: string;
  icon?: `data:image/${string}`;
  connect(): Promise<HostedWalletAccount>;
  signTransaction(input: {
    account: HostedWalletAccount;
    transaction: Uint8Array;
    chain: "solana:mainnet" | "solana:devnet";
  }): Promise<Uint8Array>;
  disconnect(): Promise<void>;
  onAccountChange(listener: (account: HostedWalletAccount | null) => void): () => void;
}
```

Do not leak package-specific wallet objects into React checkout state.
Require `standard:connect`, `standard:events`, and
`solana:signTransaction`; treat `standard:disconnect` as optional. Reject
accounts whose `chains` omit the mapped chain or whose `features` omit
`solana:signTransaction`.

- [ ] **Step 3: Enforce sign-only behavior**

The implementation must call the Wallet Standard sign-transaction feature
directly:

```typescript
const [{ signedTransaction }] = await wallet.features[
  "solana:signTransaction"
].signTransaction({ account, transaction, chain });
```

Return only `signedTransaction`. Subscribe through `standard:events` and clear
the active account/prepared attempt whenever the selected account disappears
or changes. It must not call any `sendTransaction`, sign-and-send, RPC, or
connection broadcast API.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter sdp-web test:unit -- wallet-standard-client.unit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 3: Add typed public checkout API helpers

**Files:**
- Create: `apps/sdp-web/src/app/pay/[token]/pay-public-api.ts`
- Create: `apps/sdp-web/src/app/pay/[token]/pay-public-api.unit.test.ts`
- Modify: `apps/sdp-api/src/middleware/cors.ts`
- Modify: `apps/sdp-api/src/middleware/cors.test.ts`
- Modify: `apps/sdp-api/src/app.ts`

- [ ] **Step 1: Write failing API helper tests**

Cover:

- public summary parsing;
- prepare request/response;
- submit payer-signed bytes;
- `202 processing` handling;
- stable error-code parsing;
- `Retry-After`;
- request abortion;
- body/token data never appears in thrown/logged errors.

- [ ] **Step 2: Implement narrow fetch helpers**

```typescript
getCheckoutSummary(token, signal)
prepareCheckoutAttempt(token, payerAddress, signal)
submitCheckoutAttempt(token, attemptId, payerSignedBytes, signal)
```

Base64 conversion must preserve bytes exactly. Validate all responses before
passing them to UI state.

- [ ] **Step 3: Align CORS**

Allow only the deployed SDP web origins needed for the browser to call SDP
public checkout APIs. Merchant return origins are redirect targets, not API
CORS origins.

Change `corsMiddleware` to receive `ENVIRONMENT` and `FRONTEND_URL`. Parse
`FRONTEND_URL` to one exact HTTP(S) origin and include it in the existing
allowlist. In development, retain only explicit localhost origins plus that
configured origin; remove the current arbitrary-origin fallback and wildcard
Vercel allowance. Do not add merchant return origins. Keep credentials enabled
for the authenticated dashboard and expose `Retry-After` in addition to the
existing response headers. Add production, development, malformed-config,
preflight, and denied-origin tests.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter sdp-web test:unit -- pay-public-api.unit.test.ts
pnpm --filter @sdp/api test -- src/middleware/cors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 4: Implement the client checkout state machine

**Files:**
- Create: `apps/sdp-web/src/app/pay/[token]/hosted-checkout-state.ts`
- Create: `apps/sdp-web/src/app/pay/[token]/hosted-checkout-state.unit.test.ts`

- [ ] **Step 1: Write failing transition tests**

States:

```text
loading_summary -> disconnected -> connecting -> ready -> preparing -> awaiting_signature
-> submitting -> redirecting
```

Error/terminal alternatives:

```text
failed_summary, no_compatible_wallet, wallet_rejected, attempt_expired,
validation_failed, rate_limited, processing,
paid, canceled, expired, settlement_review
```

Test stale async response suppression, disconnect during prepare, wallet
account change, signing rejection, deterministic retry, and duplicate submit
clicks. A summary initially loaded or reopened as `processing` enters the
read-only processing state immediately, suppresses all wallet controls, and
shows merchant-polling guidance; it never prepares another attempt.

- [ ] **Step 2: Implement a pure reducer**

Every transition carries an operation generation/token so late prepare/sign
responses cannot mutate a newer wallet/account state.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter sdp-web test:unit -- hosted-checkout-state.unit.test.ts
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 2: Hosted checkout and merchant controls

### Task 5: Build the hosted checkout UI

**Files:**
- Create: `apps/sdp-web/src/app/pay/[token]/hosted-checkout-client.tsx`
- Create: `apps/sdp-web/src/app/pay/[token]/wallet-picker.tsx`
- Create: `apps/sdp-web/src/app/pay/[token]/hosted-checkout-client.unit.test.tsx`
- Modify: `apps/sdp-web/src/app/pay/[token]/page.tsx:14-170`
- Modify: `apps/sdp-web/src/app/pay/[token]/loading.tsx`
- Modify: `apps/sdp-web/messages/en/shared.json`
- Modify: `apps/sdp-web/messages/fr/shared.json`
- Modify: `apps/sdp-web/messages/pt/shared.json`

- [ ] **Step 1: Write failing component tests**

Test:

- `hosted` mode renders wallet checkout, not QR/deep link;
- `solana_pay` mode preserves current QR behavior;
- amount, token, recipient, network, expiry, and sponsored-fee message display;
- only compatible wallets render;
- connect -> prepare -> wallet `signTransaction` -> submit;
- no wallet `sendTransaction` call exists;
- duplicate action clicks are disabled;
- wallet rejection remains on checkout with retry;
- expired attempt triggers fresh prepare;
- server-authoritative `returnUrl` is used after accepted submit only when it
  parses as HTTP(S);
- initially processing and paid/canceled/expired/settlement-review states
  suppress wallet controls;
- failed summary, disconnected, and no-compatible-wallet states provide safe
  explicit UX.

- [ ] **Step 2: Refactor server and client boundaries**

Keep `page.tsx` as the force-dynamic server summary loader. Pass a validated
public DTO into:

```tsx
<HostedCheckoutClient token={token} request={request} />
```

Do not pass merchant metadata, internal return URL, or API credentials.

- [ ] **Step 3: Implement wallet picker**

Use quiet SDP selection-card grammar, Inter typography, restrained status
copy, and one primary connect/retry action. Do not use marketing artwork,
gradients, glow, or monospace addresses.

- [ ] **Step 4: Implement sign and submit orchestration**

Order:

1. connect wallet;
2. prepare for selected account;
3. decode API transaction bytes with Kit;
4. call Wallet Standard `signTransaction`;
5. assert returned message bytes remain unchanged client-side;
6. submit returned bytes to SDP;
7. on `202`, parse the server-built `returnUrl`, require HTTP(S), then call
   `window.location.assign(response.returnUrl)`.

The browser-side message comparison is defense in depth; SDP remains
authoritative. The client cannot independently verify an arbitrary HTTPS origin
because the allowlist is private project configuration. Server-side Phase 1/2
tests remain authoritative for exact-origin validation and callback
construction; client tests reject malformed, `javascript:`, `data:`, and
non-HTTP(S) responses without claiming to validate the merchant allowlist.

- [ ] **Step 5: Add safe error UX**

Map stable server/wallet errors to translated text. Never show raw RPC logs,
serialized transactions, checkout token, signatures, or stack traces.

- [ ] **Step 6: Update loading and translations**

Loading skeleton should fit wallet selection/review rather than assume a QR
well. Add strict i18n parity for English, French, and Portuguese.

- [ ] **Step 7: Run unit/i18n tests**

```bash
pnpm --filter sdp-web test:unit -- hosted-checkout-client.unit.test.tsx
pnpm --filter sdp-web test:unit -- payments-route-loading.unit.test.tsx
pnpm --filter sdp-web check:i18n:strict
pnpm --filter sdp-web typecheck
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 6: Add route-level browser security

**Files:**
- Modify: `apps/sdp-web/src/proxy.ts`
- Modify: `apps/sdp-web/src/proxy.unit.test.ts`
- Modify: `apps/sdp-web/src/instrumentation-client.ts`
- Create: `apps/sdp-web/src/instrumentation-client.checkout-privacy.unit.test.ts`
- Create: `apps/sdp-web/playwright/merchant-pay-mock-api.ts`
- Create: `apps/sdp-web/playwright.merchant-pay.config.ts`
- Create: `apps/sdp-web/playwright/tests/merchant-pay-csp.production.spec.ts`
- Modify: `apps/sdp-web/package.json`

- [ ] **Step 1: Write failing header tests**

Assert `/pay/*` receives:

- restrictive Content Security Policy compatible with approved wallet
  providers;
- `frame-ancestors 'none'`;
- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`;
- no checkout token in analytics/referrer propagation.

- [ ] **Step 2: Implement route-specific headers**

For each `/pay/*` request, generate a cryptographically random base64 nonce in
`proxy.ts`, set the same CSP on the forwarded request and response so Next.js
can nonce its scripts, and use:

```text
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' {SDP_API_ORIGIN};
object-src 'none';
base-uri 'self';
form-action 'none';
frame-ancestors 'none';
```

Resolve `{SDP_API_ORIGIN}` from the canonical
`NEXT_PUBLIC_SDP_API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL` configuration and
fail closed on a non-HTTP(S) value. Add `'unsafe-eval'` to `script-src` only in
local development if Next.js requires it. Also set
`Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Do not
loosen global headers for the rest of the application. Keep `/pay/*` public in
Clerk proxy routing.

In `instrumentation-client.ts`, compute `isSensitiveCheckoutRoute` before
`Sentry.init`. On `/pay/*`, omit Replay and Feedback integrations, set traces
and replay sample rates to zero, disable browser logs, and use
`beforeSend`/`beforeSendTransaction` guards to drop any event whose request URL
or current location is a checkout route. Tests must prove no checkout-token URL
is sent to Sentry.

Add `test:e2e:merchant-pay` using only
`playwright.merchant-pay.config.ts`. That config starts the dedicated mock HTTP
API and a production `next build`/`next start` web server with both
`SDP_API_BASE_URL` and `NEXT_PUBLIC_SDP_API_BASE_URL` pointing to the mock API.
The CSP smoke spec loads a hosted summary through SSR, checks the production
nonce-bearing response CSP (without `'unsafe-eval'`), exercises hydration, and
fails on CSP violations.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter sdp-web test:unit -- proxy.unit.test.ts
pnpm --filter sdp-web test:unit -- instrumentation-client.checkout-privacy.unit.test.ts
pnpm --filter sdp-web typecheck
pnpm --filter sdp-web test:e2e:merchant-pay -- merchant-pay-csp.production.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 7: Add merchant return-origin controls and hosted request details

**Files:**
- Modify: `apps/sdp-web/src/app/dashboard/payments/requests/payment-requests-workspace.tsx`
- Modify: `apps/sdp-web/src/app/dashboard/payments/requests/payment-requests-page.data.ts`
- Modify: `apps/sdp-web/src/app/dashboard/payments/requests/payment-requests-playground-config.ts`
- Modify: `apps/sdp-web/src/app/api/dashboard/payments/requests/route.ts`
- Create: `apps/sdp-web/src/app/dashboard/payments/requests/merchant-pay-settings-panel.tsx`
- Create: `apps/sdp-web/src/app/dashboard/payments/requests/merchant-pay-settings-panel.unit.test.tsx`
- Create: `apps/sdp-web/src/app/api/dashboard/projects/[projectId]/merchant-pay-settings/route.ts`
- Modify: `apps/sdp-api/scripts/generate-playground-catalog.ts`
- Modify: `apps/sdp-web/src/lib/api-playground-openapi-catalog.ts`
- Modify: `apps/sdp-web/src/lib/api-playground-openapi-catalog.unit.test.ts`
- Modify: `apps/sdp-web/src/components/api-playground-shell.tsx`
- Modify: `apps/sdp-web/src/app/api/playground/execute/route.ts`
- Modify: `apps/sdp-web/src/app/api/playground/execute/route.unit.test.ts`
- Modify: relevant dashboard unit tests and messages

- [ ] **Step 1: Write failing dashboard tests**

Cover:

- create hosted request fields: merchant order ID, return URL, expiry, wallet,
  token, amount;
- hosted create generates/sends an idempotency key;
- one logical dashboard submission reuses its idempotency key after
  timeout/network/5xx and rotates it only after success or behavior-affecting
  input changes;
- details show internal payment ID, merchant order ID, status, checkout URL,
  latest attempt, and linked transfer;
- list omits metadata/return URL;
- processing and settlement-review badges;
- hosted link uses API `checkoutUrl`, never constructs from `publicToken`;
- origin settings normalize/deduplicate and explain exact-origin matching.
- existing dashboard create defaults to `solana_pay`; selecting
  `hosted` explicitly reveals Merchant Pay fields;
- only project members with `projects:write` may edit Merchant Pay settings.

- [ ] **Step 2: Add project return-origin settings**

Place `MerchantPaySettingsPanel` in the project-scoped Payment Requests
workspace for the active project. Its dashboard route reads/patches
`/v1/projects/:projectId`, requires `projects:write`, and edits enabled state,
allowed return origins, allowed mints, and daily sponsorship quota from Phase
1. Read-only project members see values without mutation controls. Keep the
surface operational: simple lists/fields with add/remove/validation, not a
marketing empty state.

- [ ] **Step 3: Extend create/details UI**

Preserve `solana_pay` as the default for existing dashboard creation. Add an
explicit `Solana Pay QR` / `Hosted wallet checkout` mode selector. Only the
hosted selection reveals/requires merchant order ID, return URL, expiry, and
idempotency behavior. Keep optional counterparty support but do not require
customer data.

Generate the hosted create idempotency key when a validated logical submission
snapshot is first submitted and store `{key, fingerprint}` in component state.
Reuse that key for retries after network failure, timeout, `429`, or `5xx`.
Rotate/clear it only after a successful create response or whenever any
fingerprinted input changes before retry. Disable concurrent submits; never
generate a fresh key merely because the user clicked Retry.

- [ ] **Step 4: Remove inappropriate mono address styling in touched rows**

Follow the workspace UI rule: wallet addresses, payment IDs, and transaction
signatures are normal product text, not code surfaces. Use one uniform table
body weight and size across every touched Payment Request row; only intentional
badges/chips may differ.

- [ ] **Step 5: Update API Playground config**

First extend catalog generation and parsing to retain required header
parameters. Add an editable `Idempotency-Key` header field in the shell and
allowlist/forward it through the server execution route; reject arbitrary
headers. Add generation, shell, and execution tests proving the header reaches
the API. Then merge generated Payment Request operations into the existing
payments catalog in `payment-requests-playground-config.ts`, following the
merge pattern used by other modules, and add hosted create/get/cancel examples.
Do not hand-maintain a parallel endpoint inventory when generated metadata
exists.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter sdp-web test:unit -- payment-requests
pnpm --filter sdp-web test:unit -- api-playground-openapi-catalog.unit.test.ts
pnpm --filter sdp-web test:unit -- app/api/playground/execute/route.unit.test.ts
pnpm check:api-playground
pnpm --filter sdp-web typecheck
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

## Chunk 3: End-to-end verification, docs, and rollout

### Task 8: Add hosted checkout Playwright coverage

**Files:**
- Create: `apps/sdp-web/playwright/tests/merchant-pay-checkout.mock.e2e.spec.ts`
- Create: `apps/sdp-web/playwright/fixtures/mock-wallet-standard.ts`
- Modify: `apps/sdp-web/playwright/merchant-pay-mock-api.ts`
- Modify: `apps/sdp-web/playwright.merchant-pay.config.ts`
- Modify: `apps/sdp-web/package.json`

Create a dedicated `merchant-pay-public` Playwright project with no authenticated
storage state and matching only Merchant Pay specs. The dedicated
`test:e2e:merchant-pay` package script invokes only
`playwright.merchant-pay.config.ts`; do not add the spec to the existing
`public`, `dashboard`, or `issuance` project globs.

The config starts `merchant-pay-mock-api.ts` as a real HTTP process before
starting Next.js, with both server-side `SDP_API_BASE_URL` and browser-side
`NEXT_PUBLIC_SDP_API_BASE_URL` pointed at it. This is required because
`page.tsx` fetches the summary during SSR and cannot be intercepted by
`page.route()`. The mock process implements deterministic summary, prepare,
submit, and scenario-control endpoints. It does not require merchant auth,
PostgreSQL, a sponsor, RPC, or reconciliation.

- [ ] **Step 1: Build a deterministic mock Wallet Standard provider**

The fixture must:

- expose connect and sign-transaction;
- sign only the payer slot;
- record every invoked feature;
- throw if any send/broadcast feature is requested;
- support rejection, disconnect, account change, and delayed response.

- [ ] **Step 2: Add mocked browser-flow SOL and SPL tests**

Exercise:

1. mocked public summary loads;
2. wallet connects and signs only;
3. prepare/submit request bodies are byte-checked;
4. mocked SDP submit returns processing and a server-built HTTP(S) return URL;
5. browser redirects to that URL.

Do not claim chain settlement from this mocked project. Full backend settlement
is owned by Phase 2's local-validator API fixture; Phase 3 Task 10 performs the
devnet product acceptance with deterministic merchant auth, database, sponsor,
RPC, and reconciliation setup.

- [ ] **Step 3: Add failure and concurrency tests**

Cover:

- wallet rejection and retry;
- blockhash expiry/reprepare;
- incompatible wallet filtered;
- duplicate click sends once;
- malformed/mutated wallet response rejected;
- 429 safe UI;
- canceled/expired/paid terminal page;
- settlement-review exception;
- malformed and non-HTTP(S) return URL never used;
- an arbitrary valid HTTPS URL is treated as server-authoritative, while
  server tests prove allowlist enforcement.

- [ ] **Step 4: Add mobile viewport**

Run representative mobile and desktop viewports and verify no overflow,
overlap, inaccessible controls, or wallet-picker clipping.

- [ ] **Step 5: Run scoped E2E**

```bash
pnpm --filter sdp-web test:e2e:merchant-pay -- \
  merchant-pay-checkout.mock.e2e.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 9: Publish merchant integration documentation

**Files:**
- Modify: `apps/sdp-docs/content/docs/payments/accept-overview.mdx`
- Modify: `apps/sdp-docs/content/docs/payments/concepts.mdx`
- Create: `apps/sdp-docs/content/docs/payments/merchant-pay.mdx`
- Modify: `apps/sdp-docs/content/docs/meta.json`
- Generate: `apps/sdp-docs/content/docs/reference/api/**`
- Generate: `apps/sdp-docs/public/llms.txt`
- Generate: `apps/sdp-docs/public/llms-full.txt`

- [ ] **Step 1: Add the merchant guide**

Document:

- merchant-generated `merchantOrderId`;
- required idempotency key;
- storing `merchantOrderId <-> preq_*`;
- redirecting to `checkoutUrl`;
- advisory browser callback;
- authenticated polling with `Retry-After`;
- fulfill only at `paid`;
- `settlement_review` exception handling;
- no customer private data in metadata;
- curl/TypeScript examples for create/get/cancel.

- [ ] **Step 2: Remove stale contradictions**

Existing accept docs currently say there is no hosted checkout. Update them to
distinguish hosted Merchant Pay from legacy Solana Pay.

- [ ] **Step 3: Regenerate owned artifacts**

```bash
pnpm -C apps/sdp-docs generate:api
pnpm generate:api-playground
pnpm -C apps/sdp-docs generate:ai
```

Do not hand-edit generated API reference or AI discovery files.

- [ ] **Step 4: Verify docs**

```bash
pnpm --filter sdp-docs check:links
pnpm --filter sdp-docs build
pnpm check:api-playground
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not create a git commit unless the user explicitly authorizes commits.

### Task 10: Sandbox rollout and complete verification

**Files:**
- Create: `apps/sdp-api/src/services/payments/merchant-pay-telemetry.ts`
- Create: `apps/sdp-api/src/services/payments/merchant-pay-telemetry.test.ts`
- Modify: `apps/sdp-api/src/services/payments/merchant-pay-availability.ts`
- Modify: `apps/sdp-api/src/services/payments/merchant-pay-availability.test.ts`
- Modify: `apps/sdp-api/src/routes/payments/handlers/payment-requests.ts`
- Modify: `apps/sdp-api/src/services/payments/merchant-pay/prepare-attempt.ts`
- Modify: `apps/sdp-api/src/services/payments/merchant-pay/submit-attempt.ts`
- Modify: `apps/sdp-api/src/services/payments/merchant-pay/sponsorship-limits.ts`
- Modify: `apps/sdp-api/src/services/jobs/track-pending-transfers.ts`
- Create: `apps/sdp-api/scripts/verify-merchant-pay-devnet.ts`
- Create: `docs/runbooks/merchant-pay-rollout.md`
- Modify: focused create/prepare/checkout tests

- [ ] **Step 1: Add sandbox gating**

Verify Phase 1's non-secret `MERCHANT_PAY_ENABLED` registration remains
default-off. Platform Operations owns this deployment-level switch. Project
admins with `projects:write` own
`project.settings.merchantPayEnabled`, which also defaults to `false`.

`merchant-pay-availability.ts` permits new hosted create/prepare only when the
global switch and project setting are both true; initial rollout also requires
`project.environment === "sandbox"`. Gate authenticated create and creation of
a new public attempt. Never gate summary/get, submit of an already prepared
attempt, status polling, rebroadcast, or reconciliation, so disabling rollout
cannot strand in-flight payments. Record enable/disable ownership and rollback
steps in the runbook.

- [ ] **Step 2: Add operational metrics and alerts**

Implement fixed-name counters/distributions in
`merchant-pay-telemetry.ts` using the existing structured logger plus
`@sentry/node` metrics:

```text
merchant_pay.create.total
merchant_pay.prepare.total
merchant_pay.submit.total
merchant_pay.prepare.duration_ms
merchant_pay.submit.duration_ms
merchant_pay.confirmed.duration_ms
merchant_pay.finalized.duration_ms
merchant_pay.simulation.failed
merchant_pay.attempt.expired
merchant_pay.signature.ambiguous
merchant_pay.sponsorship.lamports
merchant_pay.sponsorship.quota_rejected
merchant_pay.reconciliation.age_ms
merchant_pay.validation.failed
merchant_pay.settlement_review
merchant_pay.payment.paid
merchant_pay.payment.expired
```

Emit only project/environment/status/reason-code dimensions—never checkout
tokens, URLs, wallet accounts, transaction bytes/signatures, order IDs, or
metadata. Do not add a public browser telemetry endpoint. As specified by the
approved architecture, infer wallet rejection/abandonment from prepared or
never-submitted attempts that expire. Derive create-to-paid conversion and
expiry rates from the fixed counters.

The rollout runbook must name Platform Operations as alert owner and record the
Sentry dashboard/alert links and thresholds for ambiguous signatures, stale
submitting/processing and reconciliation failures, sponsorship quota or
fee-payer balance exhaustion, validation/simulation spikes,
`settlement_review`, confirmed transfers whose request is not paid, and paid
requests missing their fulfilled transfer. Tests assert event names,
dimensions, redaction, invariant detection, and that telemetry failures never
affect payment state.

- [ ] **Step 3: Run focused product checks**

```bash
pnpm --filter sdp-web test:unit
pnpm --filter sdp-web typecheck
pnpm --filter @sdp/api test -- merchant-pay
pnpm --filter @sdp/api typecheck
pnpm check:module-boundaries
pnpm check:api-playground
```

- [ ] **Step 4: Run workspace regression**

```bash
pnpm typecheck
pnpm --filter @sdp/api test
pnpm --filter sdp-docs check:links
pnpm --filter sdp-docs build
```

- [ ] **Step 5: Run deterministic faults, then live devnet acceptance**

Run deterministic transport/race/rollback cases through the Phase 2
local-validator fault harness, not devnet:

```bash
solana-test-validator --reset --ledger .local/merchant-pay-validator --rpc-port 8899
```

In another terminal:

```bash
MERCHANT_PAY_LOCAL_VALIDATOR=1 \
MERCHANT_PAY_FAULT_SCENARIOS=insufficient_funds,blockhash_expiry,timeout_after_send,duplicate_submit,cancel_submit_race,confirmed_rollback \
SOLANA_RPC_URL=http://127.0.0.1:8899 \
SOLANA_NETWORK=devnet \
pnpm --filter @sdp/api test:serial -- src/routes/merchant-pay.local-validator.node.test.ts
```

The test-only RPC wrapper implements each named fault and asserts recovery,
including `settlement_review`; production code has no fault switch. Wallet
rejection remains covered by the mock Wallet Standard browser suite.

Reserve live devnet for achievable SOL/SPL submission, ATA creation,
confirmed/finalized settlement, polling, and redirect checks:

```bash
SDP_API_BASE_URL=https://<sandbox-api> \
SDP_API_KEY=<sandbox-project-key> \
MERCHANT_PAY_DEVNET_PAYER_KEYPAIR=<absolute-keypair-path> \
pnpm --filter @sdp/api exec tsx scripts/verify-merchant-pay-devnet.ts
```

The script creates isolated merchant orders, configures/uses an allowlisted
devnet mint, signs as the payer, polls through finalized, verifies custody
balances and redirect fields, and cleans up project settings it changed. It
must not attempt synthetic RPC timeout or rollback behavior on live devnet.

- [ ] **Step 6: Confirm final acceptance**

- merchant can associate `merchantOrderId` with one `preq_*`;
- hosted browser wallet signs but never broadcasts;
- SDP validates, sponsors, simulates, persists, and submits;
- redirect contains only internal payment ID and advisory processing status;
- merchant backend polling is authoritative;
- public token/signed bytes/metadata are absent from logs;
- legacy Solana Pay remains functional;
- disabling rollout does not strand in-flight reconciliation.

- [ ] **Step 7: Checkpoint**

Phase 3 is ready for review. Do not create a git commit unless the user
explicitly authorizes commits.
