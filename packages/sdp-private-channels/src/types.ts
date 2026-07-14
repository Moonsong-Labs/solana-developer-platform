export type { PrivateChannelInstance, PrivateChannelInstanceInput } from "@sdp/types";

// The user-editable configuration matches the API input shape one-for-one.
// Kept as a local alias so package consumers don't need @sdp/types just to read
// `SANDBOX_DEFAULTS`.
export type PrivateChannelInstanceConfig = import("@sdp/types").PrivateChannelInstanceInput;
