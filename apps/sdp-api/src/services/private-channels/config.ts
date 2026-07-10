import {
  isSpcConfigured as isSpcEnvConfigured,
  resolveSpcConfig,
  type SpcInstanceConfig,
} from "@sdp/spc";
import type { Env } from "@/types/env";

/** Whether an SPC gateway is configured for this environment. */
export function isSpcConfigured(env: Env): boolean {
  return isSpcEnvConfigured(env);
}

/** Resolve the connected SPC instance config from the app env. */
export function getSpcConfig(env: Env): SpcInstanceConfig {
  return resolveSpcConfig(env);
}
