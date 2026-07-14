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

/** Body for `POST /probe`: the two URLs the connect flow re-probes. */
export const probeConnectionSchema = z.object({
  gatewayUrl: z.string().min(1),
  chainRpcUrl: z.string().min(1),
});

/** Query params for `GET /health`. */
export const healthQuerySchema = z.object({
  gatewayUrl: z.string().min(1),
});
