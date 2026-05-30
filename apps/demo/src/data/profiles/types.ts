import type { Account, Category } from "@capybudget/core";

/** How often a stream fires. The engine walks the window and emits one event
 *  per occurrence. */
export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly";

/** Money in. Paychecks, side income. */
export interface IncomeStream {
  merchant: string;
  /** Category name (resolved to an id against the profile's categories). */
  category: string;
  accountId: string;
  cadence: Cadence;
  amount: number;
  /** Fractional amount jitter, e.g. 0.03 → ±3%. Omit for an exact amount. */
  jitterPct?: number;
  /** Day of month the monthly/semimonthly stream lands on (1–28). For
   *  semimonthly the second landing is `dayOfMonth + 15`, clamped. Ignored for
   *  weekly/biweekly, which anchor to the window start. */
  dayOfMonth?: number;
}

/** A fixed-amount monthly bill: subscriptions, rent, loan servicing — same
 *  merchant, account, and exact cents each month. */
export interface FixedBill {
  merchant: string;
  category: string;
  accountId: string;
  cadence: Cadence;
  amount: number;
  dayOfMonth?: number;
  note?: string;
}

/** A monthly bill whose amount drifts a little (utilities, phone). A small
 *  `jitterPct` keeps the amount varying so it reads real. */
export interface VariableBill {
  merchant: string;
  category: string;
  accountId: string;
  amount: number;
  jitterPct: number;
  dayOfMonth?: number;
}

/** Everyday spend that fires several times a month with varied merchants and
 *  amounts (groceries, dining, gas). */
export interface VariableExpense {
  category: string;
  accountId: string;
  merchants: readonly string[];
  /** Times per month, randomized within the range. */
  perMonth: [number, number];
  amountRange: [number, number];
}

/** Infrequent spend that anchors a long-tail category (travel, big purchases,
 *  gifts). Fires with `probabilityPerMonth` each month so every such category
 *  earns at least one transaction across the window. */
export interface OccasionalExpense {
  category: string;
  accountId: string;
  merchants: readonly string[];
  amountRange: [number, number];
  /** Chance this fires in any given month (0–1). */
  probabilityPerMonth: number;
}

/** A periodic internal money movement emitted as a linked pair (debit from
 *  `fromAccountId`, credit to `toAccountId`). Credit-card payments, savings
 *  sweeps, brokerage contributions. */
export interface TransferStream {
  fromAccountId: string;
  toAccountId: string;
  cadence: Cadence;
  amount: number;
  jitterPct?: number;
  dayOfMonth?: number;
  note?: string;
}

/** A scenario, fully described as data. The engine reads this and a window to
 *  produce {accounts, categories, transactions}; the profile owns all flavor
 *  (merchants, amounts, balance trajectory), the engine owns all mechanics
 *  (cadence walking, jitter, ids, sorting, transfer linking). */
export interface DemoProfile {
  id: string;
  name: string;
  description: string;
  accounts: Account[];
  /** The category set, built from `createCategories()` so the demo shares the
   *  app's default taxonomy. Profiles guarantee every non-archived category
   *  here earns at least one transaction across the window. */
  categories: Category[];
  /** Opening balance per account id, in cents (may be negative for debt). */
  openingBalances: Record<string, number>;
  incomeStreams: IncomeStream[];
  fixedBills: FixedBill[];
  variableBills: VariableBill[];
  variableExpenses: VariableExpense[];
  occasionalExpenses: OccasionalExpense[];
  transfers: TransferStream[];
}
