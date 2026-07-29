const POSITIVE_USDC_AMOUNT = /^(?=[0-9.]*[1-9])(?:[0-9]+(?:\.[0-9]{0,6})?|\.[0-9]{1,6})$/;

export function getTransferAmountError(amount: string): string | null {
  const trimmed = amount.trim();
  if (!trimmed) {
    return "Enter an amount of USDC.";
  }
  if (!POSITIVE_USDC_AMOUNT.test(trimmed)) {
    return "Enter a USDC amount greater than zero with up to 6 decimal places.";
  }
  return null;
}
