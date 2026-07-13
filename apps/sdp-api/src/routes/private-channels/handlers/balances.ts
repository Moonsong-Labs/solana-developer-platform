import type { Address } from "@solana/kit";
import { badRequest } from "@/lib/errors";
import { success } from "@/lib/response";
import {
  getPrivateChannelConfig,
  getWalletChannelBalances,
  mapPrivateChannelError,
} from "@/services/private-channels";
import type { AppContext } from "../context";
import { requireAddress, resolveReadWalletPubkey } from "../context";
import { balancesQuerySchema } from "../schemas";

/**
 * GET /balances — read channel balances for a wallet across a mint set. `mints`
 * is a comma-separated override; absent, it defaults to the configured USDC mint.
 */
export async function getPrivateChannelBalances(c: AppContext) {
  try {
    const query = balancesQuerySchema.safeParse({
      wallet: c.req.query("wallet"),
      mints: c.req.query("mints"),
    });
    if (!query.success) {
      throw badRequest("wallet query parameter is required");
    }

    const walletPubkey = await resolveReadWalletPubkey(c, query.data.wallet);

    const config = getPrivateChannelConfig(c.env);
    const mints: Address[] = query.data.mints
      ? query.data.mints
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((mint) => requireAddress(mint, "mints"))
      : config.usdcMint
        ? [config.usdcMint]
        : [];

    if (mints.length === 0) {
      throw badRequest(
        "At least one mint is required (none provided and no default USDC mint is configured)."
      );
    }

    const balances = await getWalletChannelBalances(config, { wallet: walletPubkey, mints });
    return success(c, { balances });
  } catch (error) {
    throw mapPrivateChannelError(error);
  }
}
