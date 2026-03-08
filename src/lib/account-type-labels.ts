import type { AccountType } from "@/lib/types";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loans",
  asset: "Assets",
  crypto: "Crypto",
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "cash",
  "checking",
  "savings",
  "credit_card",
  "loan",
  "asset",
  "crypto",
];
