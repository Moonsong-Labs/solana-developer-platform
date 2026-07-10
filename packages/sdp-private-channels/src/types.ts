export type AuthMode = "none" | "jwt";

export interface PrivateChannelInstanceConfig {
  gatewayUrl: string;
  devnetRpcUrl: string;
  escrowProgramId: string;
  withdrawProgramId: string;
  escrowInstanceAddr: string;
  authMode: AuthMode;
  authUrl: string;
}
