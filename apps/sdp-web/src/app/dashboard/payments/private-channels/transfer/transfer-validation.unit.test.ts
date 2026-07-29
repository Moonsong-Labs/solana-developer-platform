import { describe, expect, it } from "vitest";
import { getTransferAmountError } from "./transfer-validation";

describe("getTransferAmountError", () => {
  it.each([
    "1",
    "1.25",
    ".5",
    "1.",
    "0.000001",
    " 2.5 ",
  ])("accepts backend-compatible positive USDC amount %s", (amount) => {
    expect(getTransferAmountError(amount)).toBeNull();
  });

  it("requires an amount", () => {
    expect(getTransferAmountError("")).toBe("DashboardPrivateChannels.transfer.amountRequired");
    expect(getTransferAmountError("   ")).toBe("DashboardPrivateChannels.transfer.amountRequired");
  });

  it.each([
    "0",
    "0.000000",
    "-1",
    "1.0000001",
    "1e2",
    "1..2",
    "USDC 1",
  ])("rejects backend-incompatible amount %s", (amount) => {
    expect(getTransferAmountError(amount)).toBe("DashboardPrivateChannels.transfer.amountInvalid");
  });
});
