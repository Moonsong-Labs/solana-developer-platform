import type { PrivateChannelEventDto } from "@sdp/types";

export type PrivateChannelEventSummaryKind =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "wallet"
  | "channel"
  | "instance"
  | "member"
  | "lifecycle"
  | "error"
  | "unknown";

export interface PrivateChannelEventSummaryIds {
  depositId?: string;
  withdrawalId?: string;
  transferId?: string;
  channelId?: string;
  instanceId?: string;
  walletId?: string;
  privateChannelUserId?: string;
  targetUserId?: string;
  membershipId?: string;
}

/**
 * Normalized, display-safe event data. Every value is a primitive string, so
 * list and detail views never need to coerce arbitrary payload values.
 */
export interface PrivateChannelEventSummary {
  kind: PrivateChannelEventSummaryKind;
  amount?: string;
  mint?: string;
  sender?: string;
  recipient?: string;
  owner?: string;
  destination?: string;
  depositor?: string;
  pubkey?: string;
  signature?: string;
  reason?: string;
  channelName?: string;
  gatewayUrl?: string;
  role?: string;
  latencyMs?: string;
  attempt?: string;
  confirmedAt?: string;
  ids: PrivateChannelEventSummaryIds;
}

type EventSummaryInput = {
  family: PrivateChannelEventDto["family"] | string;
  type: PrivateChannelEventDto["type"] | string;
  payload: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function readNumericDisplay(
  payload: Record<string, unknown> | null,
  key: string
): string | undefined {
  const stringValue = readString(payload, key);
  if (stringValue !== undefined) return stringValue;
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function resolveKind(family: string, type: string): PrivateChannelEventSummaryKind {
  if (type.startsWith("transfer.deposit.")) return "deposit";
  if (type.startsWith("transfer.withdrawal.")) return "withdrawal";
  if (type.startsWith("transfer.transfer.")) return "transfer";
  if (type.startsWith("member.wallet_")) return "wallet";
  if (type.startsWith("lifecycle.channel.")) return "channel";
  if (type.startsWith("lifecycle.instance.")) return "instance";
  if (family === "error" || type.startsWith("error.")) return "error";
  if (family === "transfer") return "transfer";
  if (family === "member") return "member";
  if (family === "lifecycle") return "lifecycle";
  return "unknown";
}

const ID_KEYS = [
  "depositId",
  "withdrawalId",
  "transferId",
  "channelId",
  "instanceId",
  "walletId",
  "privateChannelUserId",
  "targetUserId",
  "membershipId",
] as const satisfies readonly (keyof PrivateChannelEventSummaryIds)[];

/**
 * Extracts only known primitive fields from an event payload. API payloads are
 * untrusted at this boundary; malformed and future payloads return a useful
 * kind with whichever safe fields are present.
 */
export function summarizePrivateChannelEvent(event: EventSummaryInput): PrivateChannelEventSummary {
  const payload = asRecord(event.payload);
  const kind = resolveKind(event.family, event.type);
  const summary: PrivateChannelEventSummary = { kind, ids: {} };

  for (const key of ID_KEYS) {
    const value = readString(payload, key);
    if (value !== undefined) summary.ids[key] = value;
  }

  const amount = readString(payload, "amount");
  if (amount !== undefined) summary.amount = amount;
  const mint = readString(payload, "mint");
  if (mint !== undefined) summary.mint = mint;
  const sender = readString(payload, "sender");
  if (sender !== undefined) summary.sender = sender;
  const recipient = readString(payload, "recipient");
  if (recipient !== undefined) summary.recipient = recipient;
  const owner = readString(payload, "owner");
  if (owner !== undefined) summary.owner = owner;
  const destination = readString(payload, "destination");
  if (destination !== undefined) summary.destination = destination;
  const depositor = readString(payload, "depositor");
  if (depositor !== undefined) summary.depositor = depositor;
  const pubkey = readString(payload, "pubkey");
  if (pubkey !== undefined) summary.pubkey = pubkey;
  const signature = readString(payload, "signature");
  if (signature !== undefined) summary.signature = signature;

  const reason =
    readString(payload, "failureReason") ??
    readString(payload, "reason") ??
    readString(payload, "message");
  if (reason !== undefined) summary.reason = reason;

  const channelName =
    readString(payload, "channelName") ??
    (kind === "channel" ? readString(payload, "name") : undefined);
  if (channelName !== undefined) summary.channelName = channelName;

  const gatewayUrl = readString(payload, "gatewayUrl");
  if (gatewayUrl !== undefined) summary.gatewayUrl = gatewayUrl;
  const role = readString(payload, "role");
  if (role !== undefined) summary.role = role;
  const latencyMs = readNumericDisplay(payload, "latencyMs");
  if (latencyMs !== undefined) summary.latencyMs = latencyMs;
  const attempt = readNumericDisplay(payload, "attempt");
  if (attempt !== undefined) summary.attempt = attempt;
  const confirmedAt = readString(payload, "confirmedAt");
  if (confirmedAt !== undefined) summary.confirmedAt = confirmedAt;

  return summary;
}
