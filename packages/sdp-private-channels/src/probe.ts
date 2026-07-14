import { type GatewayHealthResult, probeGatewayHealth } from "./health";
import { probeSolanaRpc, type SolanaRpcProbeResult } from "./rpc";

export interface ConnectionProbeInput {
  gatewayUrl: string;
  chainRpcUrl: string;
}

export interface ConnectionProbeResult {
  gateway: GatewayHealthResult;
  rpc: SolanaRpcProbeResult;
  ok: boolean;
}

/**
 * Probe both endpoints the connect form cares about, in parallel.
 * `ok` is true only when the gateway reports `ready` AND the chain RPC
 * (mainnet, devnet, or any Solana JSON-RPC provider) responds to `getVersion`.
 */
export async function probeConnection(input: ConnectionProbeInput): Promise<ConnectionProbeResult> {
  const [gateway, rpc] = await Promise.all([
    probeGatewayHealth(input.gatewayUrl),
    probeSolanaRpc(input.chainRpcUrl),
  ]);
  return { gateway, rpc, ok: gateway.status === "ready" && rpc.ok };
}
