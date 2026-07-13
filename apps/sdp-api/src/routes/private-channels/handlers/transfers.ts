import type { Address } from "@solana/kit";
import { getAuth } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import { success } from "@/lib/response";
import { executeChannelTransfer, mapPrivateChannelError } from "@/services/private-channels";
import type { AppContext } from "../context";
import { requireAddress, resolveManagedWallet } from "../context";
import { transferBodySchema } from "../schemas";

/** POST /transfers — build, custody-sign, submit, and confirm an internal channel transfer. */
export async function createPrivateChannelTransfer(c: AppContext) {
  try {
    const auth = getAuth(c);

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw badRequest("Request body must be valid JSON");
    }

    const parsed = transferBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw badRequest("Invalid transfer request", { issues: parsed.error.issues });
    }

    const sourceWallet = await resolveManagedWallet(c, parsed.data.from);
    const to = requireAddress(parsed.data.to, "to");
    const mint = requireAddress(parsed.data.mint, "mint");

    const transfer = await executeChannelTransfer(c.env, {
      organizationId: auth.organizationId,
      projectId: auth.projectId ?? null,
      sourceWalletId: sourceWallet.walletId,
      from: sourceWallet.publicKey as Address,
      to,
      mint,
      amount: parsed.data.amount,
    });

    return success(c, { transfer });
  } catch (error) {
    throw mapPrivateChannelError(error);
  }
}
