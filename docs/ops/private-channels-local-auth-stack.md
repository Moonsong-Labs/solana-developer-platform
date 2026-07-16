# Running SPC + SDP locally with auth enabled

**Purpose.** Stand up **Solana Private Channels (SPC)** with its **auth service** turned on, and point **SDP** at it, so you can exercise the wallet‑verification handshake (`challenge → sign → verify`) end‑to‑end on your machine.

**Audience.** An engineer or coding agent reproducing the stack from scratch. Every step is a copy‑pasteable command with an explicit checkpoint.

**Scope.** This covers the **auth / wallet‑verification** path only. The gateway/escrow/chain legs (balances, deposit, transfer, withdraw) are *not* required for verification and are out of scope here — the full SPC stack still comes up, but you do not need to configure an escrow instance.

> **Branch matters.** The working end‑to‑end verify flow lives on **`feat/spc-wallet-verification-full`** (it carries the POC Clerk→SPC auth bridge). The lean **`feat/spc-wallet-integration`** branch intentionally returns **503** from `POST …/verify` (the auth bridge was extracted to a seam). **Use `feat/spc-wallet-verification-full` for this runbook.**

---

## 0. Architecture & ports

| Service | Port (host) | Notes |
|---|---|---|
| SPC gateway | `8899` | JSON‑RPC entry (not needed for verification) |
| SPC **auth** | `8903` | `/auth/*` + `/health` — the piece this runbook enables |
| SPC write / read node | `8900` / `8901` | loopback‑only |
| SPC streamer | `8902` | internal‑only |
| SDP API (Worker) | `8787` | `wrangler dev` |
| Postgres (SDP) | `5432` (or `5433`) | see Troubleshooting if `5432` is taken |

**Two independent secrets — do not confuse them:**
- `JWT_SECRET` — **SPC‑side.** The auth service's JWT signing key. Blank = auth disabled. Set it to enable auth.
- `PRIVATE_CHANNEL_POC_AUTH_SECRET` — **SDP‑side.** HMAC seed the POC bridge uses to derive a deterministic SPC username/password from the SDP `(org, project)`. Unrelated to `JWT_SECRET`.

---

## 1. Prerequisites

- **Docker** + Docker Compose (running).
- **Rust + Solana CLI toolchain** — SPC builds its on‑chain programs during `make build-localnet`.
- **Node + pnpm** — SDP.
- **`openssl`** — for generating secrets.
- Both repos cloned side by side:
  - SPC: `~/opt/solana-private-channels`
  - SDP: `~/opt/solana-developer-platform`
- Free ports: `8899`, `8903`, `8787`, and `5432`/`5433`.
- **Doppler CLI** logged in with access to the `solana-developer-platform` project (used by the integration test in Part 3). Internal engineers already have this; see Part 4 for a Doppler‑free interactive alternative.

---

## 2. Part 1 — SPC stack with auth enabled

```bash
cd ~/opt/solana-private-channels

# 2.1 Env template (once). Put SECRETS in the gitignored `.env` (loaded last).
cp .env.example .env.local
cat >> .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_REPLICATION_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
EOF

# 2.2 Install the Solana/SBF toolchain (once).
make install-toolchain

# 2.3 Build programs + generate the operator keypair; patches admin key + program
#     IDs into .env.local. REQUIRED before the first bring-up (once).
make build-localnet

# 2.4 Build images (include the auth image via PROFILE=auth).
make docker-build PROFILE=auth

# 2.5 Start the full stack INCLUDING the auth service.
make docker-up PROFILE=auth
```

> `JWT_SECRET` is what flips auth on: it is read by **both** the gateway and the auth container. The `auth` service is a compose profile (`profiles: [auth]`) — without `PROFILE=auth` nothing binds `:8903`.

**✅ Checkpoint — auth service is live:**

```bash
curl -fsS http://localhost:8903/health && echo " AUTH OK"

# register + login smoke (username 5–32 chars [A-Za-z0-9_-], password 6–128):
curl -sS -X POST http://localhost:8903/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"smoketest_user","password":"smoke-pass-123"}'
curl -sS -X POST http://localhost:8903/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"smoketest_user","password":"smoke-pass-123"}'
# → login returns {"token":"<jwt>"}  ← auth is working
```

Logs / stop: `make docker-logs`, `make docker-ps`, `make docker-down PROFILE=auth`. Full reset (wipe volumes): `make docker-clean && make docker-up PROFILE=auth`.

---

## 3. Part 2 — SDP

```bash
cd ~/opt/solana-developer-platform

# 3.1 Use the branch that carries the working verify flow.
git checkout feat/spc-wallet-verification-full
pnpm install

# 3.2 Postgres for SDP.
docker compose -f infra/postgres/docker-compose.yml -p postgres up -d
#   Default DSN: postgresql://sdp:sdp@127.0.0.1:5432/sdp
#   If :5432 is occupied by a local Postgres, use the 5433 workaround (Troubleshooting).
```

You are now ready to verify. There are two ways:

- **Part 3 (recommended, automated):** the integration test drives the whole handshake and asserts the DB row. Best "does it actually work" signal.
- **Part 4 (interactive):** boot the SDP API and hit the endpoint yourself.

---

## 4. Part 3 — Prove the handshake end‑to‑end (integration test)

The test `packages/sdp-api-integration/src/tests/private-channels-verify.test.ts` provisions a Privy custody wallet, seeds an auth‑enabled instance row, then drives `POST /v1/private-channels/wallets/:walletId/verify` against your local SPC auth service and asserts the persisted `verified_wallets` row.

It **soft‑skips** unless all of these are set: `RUN_INTEGRATION_TESTS=true`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVATE_CHANNELS_ENABLED=true`, `PRIVATE_CHANNEL_POC_AUTH_SECRET`, `SPC_AUTH_URL`. Privy creds come from Doppler `dev`; the rest you supply.

```bash
cd ~/opt/solana-developer-platform

# 4.1 A file-based .dev.vars conflicts with Doppler-run tests — move it aside.
[ -f apps/sdp-api/.dev.vars ] && mv apps/sdp-api/.dev.vars /tmp/sdp-api.dev.vars.bak

# 4.2 Point at your local SPC auth + local Postgres, and supply the SPC vars.
export DOPPLER_CONFIG=dev
export DATABASE_URL=postgresql://sdp:sdp@127.0.0.1:5432/sdp   # or …:5433/sdp
export SDP_INTEGRATION_SUITE=spc
export RUN_INTEGRATION_TESTS=true
export PRIVATE_CHANNELS_ENABLED=true
export PRIVATE_CHANNEL_POC_AUTH_SECRET=$(openssl rand -hex 32)
export SPC_AUTH_URL=http://localhost:8903

# 4.3 IMPORTANT: the Doppler wrapper uses a fixed --preserve-env allowlist that
#     does NOT include the SPC vars. Override it so they survive `doppler run`.
export DOPPLER_PRESERVE_ENV="DATABASE_URL,RUN_INTEGRATION_TESTS,SDP_INTEGRATION_SUITE,PRIVATE_CHANNELS_ENABLED,PRIVATE_CHANNEL_POC_AUTH_SECRET,SPC_AUTH_URL"

# 4.4 Run just the verify test (the runner bootstraps + migrates Postgres for you).
pnpm test:integration -- src/tests/private-channels-verify.test.ts
```

**✅ Checkpoint:** the `SPC wallet verification (live round-trip)` suite runs (not skipped) and passes — it verifies a Privy wallet, lists it, and re‑verifies idempotently. If it prints *skipped*, one of the gating vars above is missing (most commonly `SPC_AUTH_URL` got stripped by `--preserve-env` — recheck step 4.3).

---

## 5. Part 4 — Exercise it through a running SDP API (interactive, optional)

Use this if you want a running SDP you can curl, rather than the test harness.

```bash
cd ~/opt/solana-developer-platform

# 5.1 Generate local custody/fee keys and follow the printed instructions to
#     populate apps/sdp-api/.dev.vars.
pnpm --filter @sdp/api keygen:local
```

Create `apps/sdp-api/.dev.vars` (self‑hosted / local‑signer mode) — start from the keys `keygen:local` printed, then add:

```ini
DATABASE_URL=postgresql://sdp:sdp@127.0.0.1:5432/sdp
SIGNING_PROVIDER=local
FEE_PAYMENT_PROVIDER=native
SOLANA_RPC_URL=https://api.devnet.solana.com

# Private Channels — the two things this feature needs at runtime:
PRIVATE_CHANNELS_ENABLED=true
PRIVATE_CHANNEL_POC_AUTH_SECRET=<openssl rand -hex 32>
# (paste the CUSTODY_* / fee keys emitted by keygen:local here too)
```

> The SPC **auth URL is NOT an env var** for the running Worker — it comes from the connected instance **row** (`private_channel_instances.auth_url`). You set it when you connect/seed the instance below.

```bash
# 5.2 Boot the API (auto-migrates from DATABASE_URL, then wrangler dev on :8787).
pnpm --filter @sdp/api dev:local
```

**✅ Checkpoint:** `curl localhost:8787/health/ready` → `database: ok`.

**5.3 Seed an auth‑enabled instance row** (bypasses the gateway/escrow probe — we only exercise auth). Get your local ids first, then insert:

```bash
psql "$DATABASE_URL" -c "SELECT id FROM organizations LIMIT 1;"   # → <ORG_ID>
psql "$DATABASE_URL" -c "SELECT id FROM projects LIMIT 1;"        # → <PROJECT_ID>

psql "$DATABASE_URL" <<SQL
INSERT INTO private_channel_instances (
  id, organization_id, project_id,
  gateway_url, chain_rpc_url,
  escrow_program_id, withdraw_program_id, escrow_instance_addr,
  use_auth, auth_url, is_active, created_by
) VALUES (
  'pci_local_auth', '<ORG_ID>', '<PROJECT_ID>',
  'http://localhost:8899', 'https://api.devnet.solana.com',
  '11111111111111111111111111111111', '11111111111111111111111111111111', '11111111111111111111111111111111',
  TRUE, 'http://localhost:8903', TRUE, NULL
);
SQL
```

**5.4 Create a custody wallet and verify it.** Use the seeded local API key (role `api_admin`) and project. The wallet's provider must support message signing (**Privy** is the proven provider; `local` also signs). Send the project via the `x-project-id` header.

```bash
API=http://localhost:8787
KEY="sk_test_…"          # your seeded local API key
PROJECT="<PROJECT_ID>"   # same project as the instance row

# Create a wallet (provider: privy requires Privy creds configured; else use local)
WALLET=$(curl -sS -X POST "$API/v1/wallets" \
  -H "Authorization: Bearer $KEY" -H "x-project-id: $PROJECT" \
  -H 'content-type: application/json' \
  -d '{"provider":"privy","label":"spc-verify"}' | jq -r '.data.wallet.walletId')

# Verify it against your local SPC auth service
curl -sS -X POST "$API/v1/private-channels/wallets/$WALLET/verify" \
  -H "Authorization: Bearer $KEY" -H "x-project-id: $PROJECT" | jq

# List verified wallets
curl -sS "$API/v1/private-channels/wallets" \
  -H "Authorization: Bearer $KEY" -H "x-project-id: $PROJECT" | jq
```

**✅ Checkpoint:** the verify call returns `{ data: { wallet: { pubkey, verifiedAt, … } } }` and the wallet appears in the list. A **503 "pending SPC auth subsystem"** means you are on the lean `feat/spc-wallet-integration` branch — switch to `feat/spc-wallet-verification-full` (Part 2).

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `curl :8903/health` refused | Auth not started. Bring the stack up with `make docker-up PROFILE=auth`, and confirm `JWT_SECRET` is set (blank = auth off). |
| Login returns a token but gateway ignores RBAC | Expected — `sendTransaction` is never JWT‑gated; only reads are. Not relevant to verification. |
| SPC nodes: `password authentication failed for user "private_channel"` | Postgres initialized its volume with different creds. `make docker-clean && make docker-up PROFILE=auth`. |
| `write-node … Invalid admin key` | You skipped `make build-localnet` — it patches `PRIVATE_CHANNEL_ADMIN_KEYS`/`ADMIN_PRIVATE_KEY`. Run it, then `make docker-rebuild PROFILE=auth`. |
| Integration test prints **skipped** | A gating var is missing/stripped. Verify `SPC_AUTH_URL`, `PRIVATE_CHANNEL_POC_AUTH_SECRET`, `PRIVATE_CHANNELS_ENABLED`, `RUN_INTEGRATION_TESTS` are all in `DOPPLER_PRESERVE_ENV` (step 4.3). |
| Test warns about a legacy `.dev.vars` | Move `apps/sdp-api/.dev.vars` aside when running Doppler‑wrapped tests (step 4.1). |
| SDP migrate fails with `role "sdp" does not exist` / `:5432` conflict | A Homebrew Postgres shadows the Docker one. Run the SDP DB on **5433**: add an untracked `infra/postgres/docker-compose.override.yml` with `ports: !override ["5433:5432"]`, bring it up with both `-f` files, and use `DATABASE_URL=…@127.0.0.1:5433/sdp` everywhere above. |
| API never binds `:8787`; dashboard "Selected project required" | wrangler's interactive "install skills?" prompt blocks startup. Pre‑decline it: write `~/Library/Preferences/.wrangler/agents-skills-install.jsonc` = `{"version":1,"accepted":false,"date":"<iso>","detectedAgents":[]}`. Also wait for `/health/ready` → 200 before opening the dashboard. |
| Verify returns **503 "pending SPC auth subsystem"** | You are on `feat/spc-wallet-integration` (lean, auth seam). Use `feat/spc-wallet-verification-full`. |

---

## 7. Env var reference

**SPC (`~/opt/solana-private-channels/.env` — secrets):**

| Var | Value | Why |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | required, no default |
| `POSTGRES_REPLICATION_PASSWORD` | `openssl rand -hex 32` | required, no default |
| `JWT_SECRET` | `openssl rand -hex 32` | **enables auth** (blank = off) |
| `AUTH_PORT` | `8903` (default) | auth service host port |

**SDP (integration test env — Part 3):**

| Var | Value | Why |
|---|---|---|
| `PRIVATE_CHANNELS_ENABLED` | `true` | feature flag |
| `PRIVATE_CHANNEL_POC_AUTH_SECRET` | `openssl rand -hex 32` | POC bridge HMAC seed |
| `SPC_AUTH_URL` | `http://localhost:8903` | your local auth service |
| `SDP_INTEGRATION_SUITE` | `spc` | selects the SPC preflight |
| `RUN_INTEGRATION_TESTS` | `true` | ungates the live suite |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | from Doppler `dev` | signs the challenge |
| `DATABASE_URL` | local Postgres DSN | test DB |
| `DOPPLER_PRESERVE_ENV` | list incl. the SPC vars | so they survive `doppler run` |

---

## 8. Teardown

```bash
# SPC
cd ~/opt/solana-private-channels && make docker-down PROFILE=auth      # add: make docker-clean to wipe volumes
# SDP
cd ~/opt/solana-developer-platform && docker compose -p postgres down  # add: -v to wipe the DB
# restore your file-based .dev.vars if you moved it
[ -f /tmp/sdp-api.dev.vars.bak ] && mv /tmp/sdp-api.dev.vars.bak apps/sdp-api/.dev.vars
```
