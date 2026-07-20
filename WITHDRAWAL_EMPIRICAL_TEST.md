# Withdrawal Flow — Empirical Gateway-Auth Devnet Test

Goal: answer the open question from `WITHDRAWAL_PLAN.md §6.1` — **does the SPC gateway
accept an unauthenticated, custody-signed burn?** The withdrawal submit path does two
gateway operations that may be JWT-gated:

- **Broadcast** the signed burn → gateway `sendTransaction` (a WRITE).
- **Confirm** the burn → gateway signature-status read (a private READ).

This runbook drives one real withdrawal on devnet and reads the resulting status to
classify the gateway's behavior. Nothing here is destructive beyond burning a small
test amount of channel-chain balance.

---

## 0. Prerequisites

1. **Local API running** via the `sdp-dev` zshrc function (see the `local-dev-sdp-dev`
   memory), with:
   - `PRIVATE_CHANNELS_ENABLED=true`
   - the cron ticker firing (dev-local `--test-scheduled` + ticker) so the reconciler
     advances states — or trigger `/__scheduled` manually (below).
2. **A connected instance** for your project (gateway URL + devnet chain RPC), i.e.
   `GET /v1/private-channels/instance` returns an active instance.
3. **A custody wallet that already has a channel-chain balance to burn.** This is the
   key prerequisite — you can only withdraw what was previously deposited + credited.
   Confirm it:
   ```
   GET /v1/private-channels/balance?walletId=<WALLET>&mint=<USDC_MINT>
   ```
   The `amount` must be ≥ the amount you plan to withdraw. If it's zero, run the
   deposit flow first and wait for it to reach `credited`.
4. Project-admin auth (the `/withdrawals` routes require `payments:* + projects:admin`).

Set shell vars for the calls below (adjust host/headers to match how `sdp-dev` exposes
the API + your project-scope headers):
```
API=http://localhost:8787            # or whatever sdp-dev prints
WALLET=<custody walletId or pubkey>
# project-scope + auth headers exactly as the deposit flow uses them
```

---

## 1. Submit the withdrawal

```
curl -sS -X POST "$API/v1/private-channels/withdrawals" \
  -H "content-type: application/json" \
  -H "<project-scope + auth headers>" \
  -d '{"walletId":"'"$WALLET"'","amount":"0.10"}' | jq
```

Optionally add `"destination":"<devnet address>"` to release to a different address
(defaults to the owner wallet).

Capture the returned `id` (`wd_…`).

---

## 2. Classify the gateway's behavior from the response `status`

The service persists `pending`, broadcasts the burn, then tries to confirm. The status
in the POST response (and via `GET /v1/private-channels/withdrawals/:id`) tells you what
the gateway did:

| Response `status` | `failureReason` | Interpretation |
|---|---|---|
| `submitted` | null | **Gateway WRITE is OPEN.** Burn broadcast accepted; the confirm read didn't finish inline (transport/auth) — the reconciler will finalize it. |
| `burn_confirmed` | null | **Gateway WRITE and READ are both OPEN.** Burn broadcast + confirmed unauthenticated. Best case — no JWT needed for withdrawals yet. |
| `failed` | contains `Unauthorized` / `JWT` / `401` / `forbidden` | **Gateway WRITE is JWT-GATED.** The burn broadcast was rejected → the whole submit path is blocked on the JWT / wallet-verification work. |
| `failed` | other (e.g. `insufficient funds`, `blockhash`, a program error) | Write reached the chain but the tx itself failed — NOT an auth block. Read `failureReason` and fix the tx cause (balance, mint, blockhash). |

> The distinction that matters: **`failed` with an auth/Unauthorized reason** ⇒ gateway
> writes need the JWT ⇒ wire `createChannelGatewayRpc(env, url, { headers: { Authorization: \`Bearer \${jwt}\` } })`
> in `services/private-channels/withdraw.ts` + `withdraw-confirm.ts` once the
> wallet-verification slice lands. Any other outcome ⇒ writes are open today.

---

## 3. Watch the reconciler advance it

Poll the withdrawal (the web Withdraw page does this automatically; or curl):
```
watch -n 3 'curl -sS "$API/v1/private-channels/withdrawals/<wd_ID>" -H "<headers>" | jq "{status,burnSignature,releaseSignature,failureReason}"'
```

If the cron ticker isn't running, fire it manually each step:
```
curl -sS "$API/__scheduled?cron=*+*+*+*+*"      # dev-only scheduled trigger
```

Expected progression **if writes are open**:
- `submitted` → `burn_confirmed` — reconciler confirmed the burn on the gateway
  (this step needs the gateway READ; if it's JWT-gated, it will stick at `submitted`
  and eventually go `failed` "not found" after 5 min — note that too).
- `burn_confirmed` → `release_pending` — bookkeeping (next tick).
- `release_pending` → `released` — **requires the operator to actually release the USDC
  on devnet** from the instance escrow ATA to the destination's ATA. This is an SPC-side
  action; coordinate with the SPC team (WITHDRAWAL_PLAN §6.2). Until a release lands,
  the withdrawal stays `release_pending`; after 30 min without one it → `manual_review`
  (NEVER auto-`failed`).

---

## 4. What to record for the team

- Gateway WRITE: open / JWT-gated (from §2).
- Gateway confirm READ: open / JWT-gated (did it reach `burn_confirmed` inline or via
  the reconciler, or stick at `submitted`?).
- Whether the operator release is discoverable on the instance ATA and matches by
  `(destinationAta, mint, amount)` — i.e. did `release_pending → released` fire once a
  real release landed? If not, capture the release tx signature so we can verify the
  reconciler's ATA derivation + transfer-match assumptions (WITHDRAWAL_PLAN §6.2), and
  whether a memo/withdrawId is present for an exact match.

These three answers unblock (or confirm) the remaining withdrawal work: the JWT header
wiring (if gated) and the release-detection assumptions.
