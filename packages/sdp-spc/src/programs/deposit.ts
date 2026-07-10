/**
 * Escrow `Deposit` instruction (L1).
 *
 * The SPC escrow client is Codama-generated from `private_channel_escrow_program.json`
 * but is neither published nor committed upstream. This builder will be produced
 * by vendoring that IDL and running Codama (+ golden instruction-byte fixtures)
 * rather than hand-encoding the layout. Until then it throws so callers fail loudly.
 */

import type { Instruction } from "@solana/kit";
import { methodNotSupported } from "../errors";
import type { DepositParams } from "../types";

/** Build the escrow `Deposit` instruction from {@link DepositParams}. NOT IMPLEMENTED — throws. */
export async function getDepositInstruction(_params: DepositParams): Promise<Instruction> {
  throw methodNotSupported(
    "SPC escrow Deposit is not implemented yet: vendor the escrow IDL and generate the client."
  );
}
