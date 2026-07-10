export function isPrivateChannelsDashboardEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENTS_PRIVATE_CHANNELS_ENABLED === "true";
}
