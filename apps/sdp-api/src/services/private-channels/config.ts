/**
 * App-side config-resolution seam. Today it forwards straight to the package's
 * env resolver; when connected-instance persistence lands (the "next slice"),
 * the DB-stored instance config merges with env here — a single place every
 * private-channels handler already calls.
 */

import { type PrivateChannelConfig, resolvePrivateChannelConfig } from "@sdp/private-channels";
import type { Env } from "@/types/env";

/** Resolve the connected private-channel instance config from the app env. */
export function getPrivateChannelConfig(env: Env): PrivateChannelConfig {
  return resolvePrivateChannelConfig(env);
}
