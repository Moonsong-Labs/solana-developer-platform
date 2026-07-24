import {
  address,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { getChannelTokenBalance } from "./gateway";

// Devnet USDC (classic Token program) + a real devnet account as the owner.
const USDC = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const OWNER = address("7C1Pu8mbHaDDTFnGH8YTqemNDofqXP3XEotzSo6TbwHz");

/** Minimal fake of the Kit RPC surface the gateway helper touches. */
function fakeRpc(overrides: {
  accountInfo: unknown;
  tokenBalance?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}) {
  return {
    getAccountInfo: () => ({ send: async () => ({ value: overrides.accountInfo }) }),
    getTokenAccountBalance: () => ({ send: async () => ({ value: overrides.tokenBalance }) }),
    // biome-ignore lint/suspicious/noExplicitAny: hand-rolled test double for the Kit RPC.
  } as any;
}

describe("getChannelTokenBalance", () => {
  it("derives the classic-Token ATA deterministically", async () => {
    const a = await getChannelTokenBalance(fakeRpc({ accountInfo: null }), OWNER, USDC);
    const b = await getChannelTokenBalance(fakeRpc({ accountInfo: null }), OWNER, USDC);
    expect(a.tokenAccount).toBe(b.tokenAccount);
    expect(a.tokenAccount).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("returns balance null when the channel token account does not exist", async () => {
    const result = await getChannelTokenBalance(fakeRpc({ accountInfo: null }), OWNER, USDC);
    expect(result.balance).toBeNull();
  });

  it("maps the gateway token balance when the account exists", async () => {
    const result = await getChannelTokenBalance(
      fakeRpc({
        accountInfo: { lamports: 2039280n },
        tokenBalance: { amount: "1500000", decimals: 6, uiAmount: 1.5, uiAmountString: "1.5" },
      }),
      OWNER,
      USDC
    );
    expect(result.balance).toEqual({ amount: "1500000", decimals: 6, uiAmountString: "1.5" });
  });

  // SPC gateway signal: HTTP 403 with JSON-RPC -32002 "account not owned by caller"
  // is returned for BOTH "doesn't exist" and "you don't own this" (the gateway can't
  // tell them apart). A first-time recipient has no ATA on the channel, so the
  // baseline balance read for a deposit hits this and would otherwise fail the
  // whole flow. Treat it the same as a null account (zero balance).
  it("returns balance null when the gateway returns HTTP 403 on getAccountInfo", async () => {
    const rpc = {
      getAccountInfo: () => ({
        send: async () => {
          throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
            headers: new Headers(),
            message: "Forbidden",
            statusCode: 403,
          });
        },
      }),
      getTokenAccountBalance: () => ({
        send: async () => {
          throw new Error("should not be called when getAccountInfo 403s");
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: hand-rolled test double for the Kit RPC.
    } as any;

    const result = await getChannelTokenBalance(rpc, OWNER, USDC);
    expect(result.balance).toBeNull();
  });

  // Non-403 HTTP errors must still surface — we only coerce the ownership-check 403.
  it("propagates other transport errors (e.g. 500) from getAccountInfo", async () => {
    const rpc = {
      getAccountInfo: () => ({
        send: async () => {
          throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
            headers: new Headers(),
            message: "Internal Server Error",
            statusCode: 500,
          });
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: hand-rolled test double for the Kit RPC.
    } as any;

    await expect(getChannelTokenBalance(rpc, OWNER, USDC)).rejects.toThrow();
  });
});
