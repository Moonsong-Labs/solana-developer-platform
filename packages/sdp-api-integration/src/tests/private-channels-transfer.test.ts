/**
 * SPC internal transfer — custody-signed, live.
 *
 * Gated on SPC_TRANSFER_CONFIGURED (CUSTODY_PRIVATE_KEY + a USDC mint). Also
 * needs the custody wallet to actually hold channel balance; when it doesn't,
 * the test soft-skips (the sandbox is not funded by default). Proves
 * build → custody-sign → submit → finality end to end.
 *
 * This file imports the SDP app's signer helper, so it is kept separate from the
 * app-free connectivity/balance suite.
 */
import { createSignerFromBase58 } from "@sdp/api/services/solana";
import { executeInternalTransfer, getChannelBalance, resolveTokenProgram } from "@sdp/spc";
import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  createGatewayRpc,
  getCustodyPrivateKey,
  getUsdcMint,
  RUN_INTEGRATION_TESTS,
  SPC_TRANSFER_CONFIGURED,
} from "../helpers/private-channels";

describe.skipIf(!SPC_TRANSFER_CONFIGURED || !RUN_INTEGRATION_TESTS)(
  "Private Channels internal transfer",
  () => {
    it("build → custody-sign → submit → finalize a self-transfer", async () => {
      const rpc = createGatewayRpc();
      const mint = getUsdcMint() as Address;
      const signer = await createSignerFromBase58(getCustodyPrivateKey() as string);
      const from = signer.address;

      const tokenProgram = await resolveTokenProgram(rpc, mint);
      const before = await getChannelBalance(rpc, { wallet: from, mint, tokenProgram });
      if (!before.exists || before.amount < 1n) {
        console.warn(
          `Skipping SPC transfer: wallet ${from} holds no channel balance for mint ${mint}.`
        );
        return;
      }

      const receipt = await executeInternalTransfer({
        rpc,
        from,
        to: from,
        mint,
        tokenProgram,
        amount: 1n,
        decimals: before.decimals,
        authority: signer,
      });

      expect(receipt.signature).toBeTruthy();
      expect(["confirmed", "finalized"]).toContain(receipt.confirmationStatus);
    });
  }
);
