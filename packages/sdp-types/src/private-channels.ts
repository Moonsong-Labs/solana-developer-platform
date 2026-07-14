// Private Channels: SDP-side connection metadata for a Solana Private Channels
// (SPC) instance. One record per project. See PROPOSAL.md §5.1.

/**
 * User-editable connection fields. These populate the connect form and are
 * validated identically on the client and server via the zod schema in
 * `@sdp/private-channels/schema`.
 *
 * SPC's auth service is a separate binary from the gateway (sandbox gateway is
 * `:8899`, auth is `:8903`). When `useAuth` is true, `authUrl` must be present
 * and non-empty. When false, `authUrl` is the empty string and ignored.
 */
export interface PrivateChannelInstanceInput {
  gatewayUrl: string;
  chainRpcUrl: string;
  escrowProgramId: string;
  withdrawProgramId: string;
  escrowInstanceAddr: string;
  useAuth: boolean;
  authUrl: string;
}

/**
 * Persisted instance row projected to the API contract. Only the input fields
 * plus scoping and bookkeeping — probe status is intentionally NOT persisted;
 * it's a transient UX signal produced by the Test Connection button.
 *
 * `isActive` distinguishes the currently-connected instance from historical
 * rows that a project has disconnected from but not deleted. At most one
 * active row exists per project at any time.
 */
export interface PrivateChannelInstance extends PrivateChannelInstanceInput {
  id: string;
  organizationId: string;
  projectId: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateChannelInstanceResponse {
  instance: PrivateChannelInstance;
}

export interface PrivateChannelInstanceEnvelope {
  instance: PrivateChannelInstance | null;
}
