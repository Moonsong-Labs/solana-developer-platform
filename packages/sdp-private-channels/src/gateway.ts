/**
 * SPC gateway JSON-RPC client.
 *
 * The SPC gateway (`:8899`) speaks a SUBSET of Solana JSON-RPC (sendTransaction,
 * getLatestBlockhash, getAccountInfo, getTokenAccountBalance, getSignaturesForAddress,
 * getTransaction, ...). It is not a full validator, so unsupported methods
 * (e.g. `getVersion`) return "Method not found" — don't call them.
 *
 * Because it is Solana-JSON-RPC-compatible, we reuse `@sdp/rpc`'s Kit client,
 * just re-pointed at the gateway URL. The engine passes a structural env in
 * (never `process.env`), the same discipline as `config.ts`.
 */

import type { RpcEnv } from "@sdp/rpc";
import { createRpc, getAccountInfo, type SolanaRpc } from "@sdp/rpc/solana";
import {
  type Address,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export interface GatewayClientOptions {
  /**
   * Extra request headers for the gateway. Reserved for the future JWT
   * `Authorization` seam — when the gateway switches to `authMode: "jwt"`, pass
   * `{ Authorization: \`Bearer \${token}\` }` here. `Authorization` is already
   * permitted by `@sdp/rpc`'s header policy, so no plumbing change is needed then.
   */
  headers?: Readonly<Record<string, string>>;
}

/**
 * Build a Solana-Kit RPC client pointed at the SPC gateway. This is `@sdp/rpc`'s
 * standard client with the URL overridden; every read/write helper in
 * `@sdp/rpc/solana` works against the returned client.
 */
export function createChannelGatewayRpc(
  env: RpcEnv,
  gatewayUrl: string,
  options?: GatewayClientOptions
): SolanaRpc {
  return createRpc(env, { rpcUrl: gatewayUrl, headers: options?.headers });
}

/** A channel token-account balance as reported by the gateway. */
export interface ChannelTokenAccountBalance {
  /** Raw base-unit amount (string to stay JSON- and precision-safe). */
  amount: string;
  /** Mint decimals reported by the gateway. */
  decimals: number;
  /** Human-readable amount string (prefer `amount` for arithmetic). */
  uiAmountString: string;
}

/** Result of reading an owner's channel token balance. */
export interface ChannelTokenBalanceResult {
  /** The derived associated-token account that was probed on the channel. */
  tokenAccount: Address;
  /**
   * The balance, or `null` when the account does not exist on the channel yet
   * (a never-credited owner) — callers treat `null` as an effective zero.
   */
  balance: ChannelTokenAccountBalance | null;
}

/**
 * Read an owner's channel token balance for `mint`. Channel token accounts derive
 * under the CLASSIC Token program (per the SPC devnet guide), so its program id is
 * used as the ATA `tokenProgram` seed. Returns `balance: null` (not an error) when
 * the owner has no token account on the channel yet.
 */
export async function getChannelTokenBalance(
  rpc: SolanaRpc,
  owner: Address,
  mint: Address
): Promise<ChannelTokenBalanceResult> {
  const [tokenAccount] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Disambiguate "no account" from a real RPC failure up front: a missing ATA is
  // an expected zero balance, whereas getTokenAccountBalance would throw for it.
  //
  // The SPC gateway conflates "account doesn't exist" and "you don't own this
  // account" into one HTTP 403 (JSON-RPC -32002 "account not owned by caller") —
  // it can't establish ownership on an account that doesn't exist. A first-time
  // recipient has no ATA yet, so the pre-broadcast baseline read would 403 and
  // fail the whole deposit. Treat that 403 the same as `null` (effective zero
  // balance) so the deposit can proceed to the on-chain broadcast; the reconciler
  // picks up the credit delta later. Only 403 on THIS call is swallowed — writes
  // and other reads still surface auth failures.
  let account: Awaited<ReturnType<typeof getAccountInfo>>;
  try {
    account = await getAccountInfo(rpc, tokenAccount);
  } catch (error) {
    if (isGatewayForbiddenAccountRead(error)) {
      return { tokenAccount, balance: null };
    }
    throw error;
  }
  if (account === null) {
    return { tokenAccount, balance: null };
  }

  const { value } = await rpc.getTokenAccountBalance(tokenAccount).send();
  return {
    tokenAccount,
    balance: {
      amount: value.amount,
      decimals: value.decimals,
      uiAmountString: value.uiAmountString,
    },
  };
}

/**
 * Recognise the SPC gateway's HTTP 403 for account reads. Uses Solana Kit's
 * structured `SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR` (`context.statusCode`) to
 * avoid string-matching on the underlying `HTTP error (403): Forbidden` message.
 */
function isGatewayForbiddenAccountRead(error: unknown): boolean {
  return (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    error.context.statusCode === 403
  );
}
