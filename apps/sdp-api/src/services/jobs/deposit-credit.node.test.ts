import { describe, expect, it } from "vitest";
import { type DepositForCredit, planDepositCredits } from "./deposit-credit";

/** Build a deposit row slice (decimals default to 0 in tests for readable amounts). */
function dep(
  id: string,
  status: DepositForCredit["status"],
  amount: string,
  baselineCredited = "0"
): DepositForCredit {
  return { id, status, amount, baseline_credited: baselineCredited };
}

describe("planDepositCredits", () => {
  it("credits nothing when the balance is below the deposit threshold", () => {
    expect(planDepositCredits([dep("a", "confirmed", "10")], 5n, 0)).toEqual([]);
  });

  it("credits a single confirmed deposit once the balance covers it", () => {
    expect(planDepositCredits([dep("a", "confirmed", "10")], 10n, 0)).toEqual(["a"]);
  });

  it("does NOT credit two concurrent deposits off a single balance increase", () => {
    // Both baselined at 0; balance rose by only one deposit's worth (10).
    const deposits = [dep("a", "confirmed", "10"), dep("b", "confirmed", "10")];
    expect(planDepositCredits(deposits, 10n, 0)).toEqual(["a"]);
  });

  it("credits both concurrent deposits only when the balance covers their sum", () => {
    const deposits = [dep("a", "confirmed", "10"), dep("b", "confirmed", "10")];
    expect(planDepositCredits(deposits, 20n, 0)).toEqual(["a", "b"]);
  });

  it("respects a non-zero baseline (pre-existing balance)", () => {
    const deposits = [dep("a", "confirmed", "10", "5")]; // needs balance >= 15
    expect(planDepositCredits(deposits, 14n, 0)).toEqual([]);
    expect(planDepositCredits(deposits, 15n, 0)).toEqual(["a"]);
  });

  it("counts already-credited deposits toward the threshold without re-crediting them", () => {
    const deposits = [dep("a", "credited", "10"), dep("b", "confirmed", "10")];
    expect(planDepositCredits(deposits, 15n, 0)).toEqual([]); // b needs balance >= 20
    expect(planDepositCredits(deposits, 20n, 0)).toEqual(["b"]); // a is not re-credited
  });

  it("excludes failed deposits from the balance accounting", () => {
    const deposits = [dep("a", "failed", "10"), dep("b", "confirmed", "10")];
    // The failed deposit moved no funds; b is credited off its own 10.
    expect(planDepositCredits(deposits, 10n, 0)).toEqual(["b"]);
  });

  it("blocks later confirmed deposits behind an older in-flight deposit", () => {
    const deposits = [dep("a", "submitted", "10"), dep("b", "confirmed", "10")];
    // Can't attribute balance past the unconfirmed 'a', even with ample balance.
    expect(planDepositCredits(deposits, 20n, 0)).toEqual([]);
  });

  it("still credits a confirmed deposit that precedes an in-flight one", () => {
    const deposits = [dep("a", "confirmed", "10"), dep("b", "submitted", "10")];
    expect(planDepositCredits(deposits, 10n, 0)).toEqual(["a"]);
  });

  it("returns [] for empty or all-failed groups", () => {
    expect(planDepositCredits([], 100n, 0)).toEqual([]);
    expect(planDepositCredits([dep("a", "failed", "10")], 100n, 0)).toEqual([]);
  });

  it("honors token decimals when parsing amounts", () => {
    const deposits = [dep("a", "confirmed", "1.5")]; // 1.5 USDC = 1_500_000 base units
    expect(planDepositCredits(deposits, 1_499_999n, 6)).toEqual([]);
    expect(planDepositCredits(deposits, 1_500_000n, 6)).toEqual(["a"]);
  });
});
