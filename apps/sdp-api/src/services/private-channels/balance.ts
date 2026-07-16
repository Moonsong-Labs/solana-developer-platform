/**
 * Channel balance read.
 *
 * Balances live at the SPC layer, one per (wallet, mint), derived by reading the
 * owner's classic-Token ATA through the gateway. Logical channels are labels, so
 * a wallet in multiple channels shows the SAME balance in each — never
 * materialize a per-channel balance.
 *
 * The connection comes from the project's ACTIVE persisted instance (loaded by
 * the caller and passed in), matching the config-in pattern used by the rest of
 * this service. The transport (`createChannelGatewayRpc`/`getChannelTokenBalance`)
 * is config-source-agnostic.
 */

import { createChannelGatewayRpc, getChannelTokenBalance } from "@sdp/private-channels";
import { assertValidAddress } from "@sdp/solana/address";
import type { PrivateChannelBalance, PrivateChannelInstance, SolanaCluster } from "@sdp/types";
import { WELL_KNOWN_TOKENS } from "@sdp/types";
import type { Env } from "@/types/env";

/** The instance fields the balance read needs: gateway URL + a cluster hint. */
type BalanceInstance = Pick<PrivateChannelInstance, "gatewayUrl" | "chainRpcUrl">;

/**
 * Infer the Solana cluster from the instance's chain RPC URL. The persisted
 * instance stores no explicit cluster, and the sandbox is devnet — so an
 * unrecognized URL is treated as devnet.
 */
function inferCluster(chainRpcUrl: string): SolanaCluster {
  return /mainnet/i.test(chainRpcUrl) ? "mainnet-beta" : "devnet";
}

/**
 * The mint a channel balance defaults to: the well-known USDC mint for the
 * cluster (USDC is the only whitelisted mint on the sandbox instance today).
 */
function defaultChannelMint(cluster: SolanaCluster): string {
  const mint = WELL_KNOWN_TOKENS.USDC.mints[cluster];
  if (!mint) {
    throw new Error(`No known USDC mint for cluster ${cluster}`);
  }
  return mint;
}

/** Decimals for a well-known mint on this cluster, when recognized. */
function knownMintDecimals(mint: string, cluster: SolanaCluster): number | undefined {
  for (const token of Object.values(WELL_KNOWN_TOKENS)) {
    // Not every well-known token is deployed on every cluster (some carry only a
    // mainnet mint), so index the mint map defensively.
    const clusterMint = (token.mints as Partial<Record<SolanaCluster, string>>)[cluster];
    if (clusterMint === mint) {
      return token.decimals;
    }
  }
  return undefined;
}

/** Read an owner's channel token balance through the gateway → wire DTO. */
export async function getChannelBalance(
  env: Env,
  { instance, owner, mint }: { instance: BalanceInstance; owner: string; mint?: string }
): Promise<PrivateChannelBalance> {
  const cluster = inferCluster(instance.chainRpcUrl);
  const ownerAddress = assertValidAddress(owner, "owner");
  const mintAddress = assertValidAddress(mint ?? defaultChannelMint(cluster), "mint");

  const rpc = createChannelGatewayRpc(env, instance.gatewayUrl);
  const { tokenAccount, balance } = await getChannelTokenBalance(rpc, ownerAddress, mintAddress);

  // A missing token account is a zero balance; fall back to the mint's known
  // decimals so the DTO stays accurate even before the owner is first credited.
  const decimals = balance?.decimals ?? knownMintDecimals(mintAddress, cluster) ?? 0;
  return {
    owner: ownerAddress,
    mint: mintAddress,
    tokenAccount,
    amount: balance?.amount ?? "0",
    decimals,
    uiAmount: balance?.uiAmountString ?? "0",
  };
}
