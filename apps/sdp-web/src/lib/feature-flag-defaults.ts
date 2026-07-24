type RuntimeFlagEnvironment = {
  assetProfilesEnabled?: string;
  nodeEnvironment?: string;
  privateChannelsEnabled?: string;
  sdpEnvironment?: string;
  vercelEnvironment?: string;
};

function normalize(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

export function getHomepageOpenSignupDefault({
  vercelEnvironment,
}: Pick<RuntimeFlagEnvironment, "vercelEnvironment">): boolean {
  // Preserve open signup for non-Vercel/self-hosted deployments. Vercel
  // production is the only environment that should fail back to the waitlist.
  return normalize(vercelEnvironment) !== "production";
}

export function getAssetProfilesDefault({
  assetProfilesEnabled,
  nodeEnvironment,
  sdpEnvironment,
  vercelEnvironment,
}: RuntimeFlagEnvironment): boolean {
  const vercel = normalize(vercelEnvironment);
  if (vercel) {
    return vercel === "preview" || vercel === "development";
  }

  const sdp = normalize(sdpEnvironment);
  if (sdp) {
    return sdp === "development" || normalize(assetProfilesEnabled) === "true";
  }

  const node = normalize(nodeEnvironment);
  return node === "development" || node === "test";
}

export function getPrivateChannelsDefault({
  privateChannelsEnabled,
}: Pick<RuntimeFlagEnvironment, "privateChannelsEnabled">): boolean {
  // Private Channels is opt-in everywhere, including local development: it
  // needs a reachable SPC instance to be useful. The dashboard reads the same
  // PRIVATE_CHANNELS_ENABLED the API gates its routes on, so the nav can never
  // offer a surface the API will 403 — which means this must accept exactly the
  // values the API's isTruthyFlag does (apps/sdp-api/src/lib/feature-flags.ts),
  // not just "true", or the two sides would disagree on e.g. "1".
  const value = normalize(privateChannelsEnabled);
  return value !== undefined && ["1", "true", "yes", "on"].includes(value);
}
