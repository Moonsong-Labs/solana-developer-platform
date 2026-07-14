import { privateChannelInstanceInputSchema } from "@sdp/private-channels";
import { z } from "zod";

// `confirmReactivate` is a client acknowledgement that we're about to overwrite
// config on an existing (inactive) row that downstream data may be bound to.
export const connectPrivateChannelInstanceSchema = z.intersection(
  privateChannelInstanceInputSchema,
  z.object({ confirmReactivate: z.boolean().optional() })
);

export type ConnectPrivateChannelInstanceInput = z.infer<
  typeof connectPrivateChannelInstanceSchema
>;

/** Query params for `GET /health`. */
export const healthQuerySchema = z.object({
  /** Candidate SPC gateway base URL to probe. */
  gatewayUrl: z.string().min(1),
});
