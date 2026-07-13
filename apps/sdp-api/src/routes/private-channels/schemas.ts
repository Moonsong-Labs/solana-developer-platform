import { z } from "zod";

/** Query params for `GET /health`. */
export const healthQuerySchema = z.object({
  /** Candidate SPC gateway base URL to probe. */
  gatewayUrl: z.string().min(1),
});
