/**
 * Withdraw `WithdrawFunds` instruction (channel).
 *
 * Will be Codama-generated from `private_channel_withdraw_program.json`
 * (+ golden instruction-byte fixtures). Throws until then.
 */

import type { Instruction } from "@solana/kit";
import { methodNotSupported } from "../errors";
import type { WithdrawParams } from "../types";

/** Build the `WithdrawFunds` burn instruction from {@link WithdrawParams}. NOT IMPLEMENTED — throws. */
export async function getWithdrawFundsInstruction(_params: WithdrawParams): Promise<Instruction> {
  throw methodNotSupported(
    "SPC WithdrawFunds is not implemented yet: vendor the withdraw IDL and generate the client."
  );
}
