import type { MessageKey } from "@/i18n/messages";

const POSITIVE_USDC_AMOUNT = /^(?=[0-9.]*[1-9])(?:[0-9]+(?:\.[0-9]{0,6})?|\.[0-9]{1,6})$/;

/**
 * Returns the message key for the amount problem, or null when it is valid.
 * Keys rather than text, so the client renders it in the caller's locale even
 * when the check runs in a server action.
 */
export function getTransferAmountError(amount: string): MessageKey | null {
  const trimmed = amount.trim();
  if (!trimmed) {
    return "DashboardPrivateChannels.transfer.amountRequired";
  }
  if (!POSITIVE_USDC_AMOUNT.test(trimmed)) {
    return "DashboardPrivateChannels.transfer.amountInvalid";
  }
  return null;
}
