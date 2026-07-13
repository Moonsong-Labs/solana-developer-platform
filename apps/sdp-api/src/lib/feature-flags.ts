import { isPrivateChannelConfigured } from "@sdp/private-channels";
import type { Env } from "@/types/env";

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isRecurringPaymentsEnabled(env: Pick<Env, "PAYMENTS_RECURRING_ENABLED">): boolean {
  return isTruthyFlag(env.PAYMENTS_RECURRING_ENABLED);
}

export function isRecurringPaymentCollectionEnabled(
  env: Pick<Env, "PAYMENTS_RECURRING_COLLECTION_ENABLED">
): boolean {
  return isTruthyFlag(env.PAYMENTS_RECURRING_COLLECTION_ENABLED);
}

export function isAssetProfilesEnabled(env: Pick<Env, "ASSET_PROFILES_ENABLED">): boolean {
  return isTruthyFlag(env.ASSET_PROFILES_ENABLED);
}

/**
 * Private Channels is "enabled" when a gateway URL is configured — connecting an
 * instance is the switch, so there is no separate on/off flag (unlike the boolean
 * flags above). Delegates to the package's canonical check to keep one definition
 * of "configured".
 */
export function isPrivateChannelsEnabled(env: Pick<Env, "PRIVATE_CHANNEL_GATEWAY_URL">): boolean {
  return isPrivateChannelConfigured(env);
}
