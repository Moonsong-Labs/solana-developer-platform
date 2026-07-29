import { z } from "zod";

/** Positive default-USDC decimal amount with at most six fractional digits. */
export const privateChannelTransferAmountSchema = z
  .string()
  .regex(/^\s*(?=[0-9.]*[1-9])(?:[0-9]+(?:\.[0-9]{0,6})?|\.[0-9]{1,6})\s*$/)
  .transform((amount) => amount.trim());
