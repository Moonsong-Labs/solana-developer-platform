import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateChannelDepositRow, PrivateChannelWithdrawalRow } from "@/db/repositories";
import * as eventService from "@/services/private-channels/event.service";
import type { Env } from "@/types/env";
import { emitDepositEvent } from "./deposit-events";
import { emitWithdrawalEvent } from "./withdraw-events";

const ENV = {} as Env;
const NOW = "2026-07-30T12:00:00.000Z";

const DEPOSIT: PrivateChannelDepositRow = {
  id: "dep_event_test",
  organization_id: "org_event_test",
  project_id: "prj_event_test",
  instance_id: "pci_event_test",
  wallet_id: "wallet_depositor",
  depositor: "wallet-a",
  recipient: "wallet-b",
  mint: "mint",
  amount: "1.5",
  status: "submitted",
  signature: "deposit-signature",
  settlement_ref: null,
  failure_reason: null,
  context: {},
  created_at: NOW,
  updated_at: NOW,
};

const WITHDRAWAL: PrivateChannelWithdrawalRow = {
  id: "wd_event_test",
  organization_id: "org_event_test",
  project_id: "prj_event_test",
  instance_id: "pci_event_test",
  wallet_id: "wallet_owner",
  owner: "wallet-c",
  destination: "wallet-d",
  mint: "mint",
  amount: "2.5",
  status: "confirmed",
  signature: "withdrawal-signature",
  settlement_ref: null,
  failure_reason: null,
  context: {},
  created_at: NOW,
  updated_at: NOW,
};

let emit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  emit = vi.fn(async () => undefined);
  vi.spyOn(eventService, "createPrivateChannelEventService").mockReturnValue({
    emit,
  } as unknown as eventService.PrivateChannelEventService);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("financial event emitters", () => {
  it("makes deposit events visible to depositor and recipient wallets", async () => {
    await emitDepositEvent(ENV, DEPOSIT, "transfer.deposit.submitted", "pending");

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        wallets: [DEPOSIT.depositor, DEPOSIT.recipient],
      })
    );
  });

  it("makes withdrawal events visible to owner and destination wallets", async () => {
    await emitWithdrawalEvent(ENV, WITHDRAWAL, "transfer.withdrawal.confirmed", "confirmed");

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        wallets: [WITHDRAWAL.owner, WITHDRAWAL.destination],
      })
    );
  });
});
