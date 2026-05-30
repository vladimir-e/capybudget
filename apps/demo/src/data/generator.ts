import type { Account, Category, Transaction } from "@capybudget/core";
import { Rng } from "./rng";
import type {
  Cadence,
  DemoProfile,
  FixedBill,
  IncomeStream,
  OccasionalExpense,
  TransferStream,
  VariableBill,
  VariableExpense,
} from "./profiles/types";

export interface GenerateOptions {
  /** "Now" is injected so the engine never reads the wall clock — that is what
   *  keeps output deterministic and the window anchored to the caller's clock. */
  now: Date;
  /** How far back the window reaches, in whole years. */
  yearsBack: number;
  /** Seed for the PRNG; same seed + same inputs → identical output. */
  seed: number;
}

export interface ScenarioData {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

const HMS = (h: number, m: number, s: number): string =>
  `${pad(h)}:${pad(m)}:${pad(s)}`;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Matches the format analytics slice on (`datetime.slice(0, 10)`). */
function datetimeString(d: Date, time: string): string {
  return `${dateString(d)}T${time}`;
}

/** Clamp a day-of-month to a value that exists in every month, so monthly
 *  streams never skip February. */
function clampDom(day: number): number {
  return Math.min(Math.max(day, 1), 28);
}

function categoryByName(categories: Category[]): (name: string) => string {
  const byName = new Map(categories.map((c) => [c.name, c.id]));
  return (name: string) => byName.get(name) ?? "";
}

interface Engine {
  rng: Rng;
  start: Date;
  now: Date;
  catId: (name: string) => string;
  txns: Transaction[];
  counter: number;
}

function emit(
  engine: Engine,
  fields: Pick<Transaction, "datetime" | "type" | "amount" | "accountId"> &
    Partial<Transaction>,
): Transaction {
  engine.counter += 1;
  const txn: Transaction = {
    id: `gen-txn-${engine.counter}`,
    datetime: fields.datetime,
    type: fields.type,
    amount: fields.amount,
    categoryId: fields.categoryId ?? "",
    accountId: fields.accountId,
    transferPairId: fields.transferPairId ?? "",
    merchant: fields.merchant ?? "",
    note: fields.note ?? "",
    createdAt: `${fields.datetime}Z`,
  };
  engine.txns.push(txn);
  return txn;
}

/** Months from `start` (inclusive) up to and including the month of `now`,
 *  each as a Date pinned to the first of that month. */
function monthsInWindow(start: Date, now: Date): Date[] {
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Every date a cadence lands on across the whole window. Monthly and
 *  semimonthly key off the configured day-of-month; weekly and biweekly walk
 *  continuously from the window start so their intervals stay an exact 7 or 14
 *  days. */
function occurrences(
  engine: Engine,
  cadence: Cadence,
  dayOfMonth: number,
): Date[] {
  const dates: Date[] = [];

  if (cadence === "weekly" || cadence === "biweekly") {
    const step = cadence === "weekly" ? 7 : 14;
    const cursor = new Date(engine.start);
    while (cursor <= engine.now) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + step);
    }
    return dates;
  }

  for (const month of monthsInWindow(engine.start, engine.now)) {
    const y = month.getFullYear();
    const m = month.getMonth();
    const days =
      cadence === "semimonthly"
        ? [clampDom(dayOfMonth), clampDom(dayOfMonth + 15)]
        : [clampDom(dayOfMonth)];
    for (const d of days) {
      const date = new Date(y, m, d);
      if (date >= engine.start && date <= engine.now) dates.push(date);
    }
  }
  return dates;
}

function emitIncome(engine: Engine, stream: IncomeStream): void {
  const dom = stream.dayOfMonth ?? 15;
  for (const day of occurrences(engine, stream.cadence, dom)) {
    const amount = stream.jitterPct
      ? engine.rng.jitter(stream.amount, stream.jitterPct)
      : stream.amount;
    emit(engine, {
      datetime: datetimeString(day, HMS(9, 0, 0)),
      type: "income",
      amount,
      accountId: stream.accountId,
      categoryId: engine.catId(stream.category),
      merchant: stream.merchant,
    });
  }
}

function emitFixedBill(engine: Engine, bill: FixedBill): void {
  const dom = bill.dayOfMonth ?? 1;
  for (const day of occurrences(engine, bill.cadence, dom)) {
    emit(engine, {
      datetime: datetimeString(day, HMS(8, 0, 0)),
      type: "expense",
      amount: -bill.amount,
      accountId: bill.accountId,
      categoryId: engine.catId(bill.category),
      merchant: bill.merchant,
      note: bill.note ?? "",
    });
  }
}

function emitVariableBill(engine: Engine, bill: VariableBill): void {
  const dom = bill.dayOfMonth ?? 5;
  for (const day of occurrences(engine, "monthly", dom)) {
    emit(engine, {
      datetime: datetimeString(day, HMS(10, 0, 0)),
      type: "expense",
      amount: -engine.rng.jitter(bill.amount, bill.jitterPct),
      accountId: bill.accountId,
      categoryId: engine.catId(bill.category),
      merchant: bill.merchant,
    });
  }
}

function emitVariableExpense(engine: Engine, spend: VariableExpense): void {
  const catId = engine.catId(spend.category);
  for (const month of monthsInWindow(engine.start, engine.now)) {
    const count = engine.rng.nextInt(spend.perMonth[0], spend.perMonth[1]);
    const daysInMonth = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    for (let i = 0; i < count; i++) {
      const day = new Date(
        month.getFullYear(),
        month.getMonth(),
        engine.rng.nextInt(1, daysInMonth),
      );
      if (day < engine.start || day > engine.now) continue;
      emit(engine, {
        datetime: datetimeString(
          day,
          HMS(engine.rng.nextInt(7, 20), engine.rng.nextInt(0, 59), 0),
        ),
        type: "expense",
        amount: -engine.rng.nextInt(spend.amountRange[0], spend.amountRange[1]),
        accountId: spend.accountId,
        categoryId: catId,
        merchant: engine.rng.pick(spend.merchants),
      });
    }
  }
}

function emitOccasional(engine: Engine, spend: OccasionalExpense): void {
  const catId = engine.catId(spend.category);
  const months = monthsInWindow(engine.start, engine.now);
  let fired = false;
  for (const month of months) {
    if (!engine.rng.chance(spend.probabilityPerMonth)) continue;
    fireOccasional(engine, spend, catId, month);
    fired = true;
  }
  // Guarantee category coverage: if probability never tripped across the whole
  // window, force one occurrence in the final month.
  if (!fired && months.length > 0) {
    fireOccasional(engine, spend, catId, months[months.length - 1]);
  }
}

function fireOccasional(
  engine: Engine,
  spend: OccasionalExpense,
  catId: string,
  month: Date,
): void {
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  let day = new Date(
    month.getFullYear(),
    month.getMonth(),
    engine.rng.nextInt(1, daysInMonth),
  );
  if (day < engine.start) day = new Date(engine.start);
  if (day > engine.now) day = new Date(engine.now);
  emit(engine, {
    datetime: datetimeString(day, HMS(engine.rng.nextInt(9, 19), 0, 0)),
    type: "expense",
    amount: -engine.rng.nextInt(spend.amountRange[0], spend.amountRange[1]),
    accountId: spend.accountId,
    categoryId: catId,
    merchant: engine.rng.pick(spend.merchants),
  });
}

function emitTransfer(engine: Engine, transfer: TransferStream): void {
  const dom = transfer.dayOfMonth ?? 28;
  for (const day of occurrences(engine, transfer.cadence, dom)) {
    const amount = transfer.jitterPct
      ? engine.rng.jitter(transfer.amount, transfer.jitterPct)
      : transfer.amount;
    const datetime = datetimeString(day, HMS(12, 0, 0));
    const debit = emit(engine, {
      datetime,
      type: "transfer",
      amount: -amount,
      accountId: transfer.fromAccountId,
      note: transfer.note ?? "",
    });
    const credit = emit(engine, {
      datetime,
      type: "transfer",
      amount,
      accountId: transfer.toAccountId,
      note: transfer.note ?? "",
    });
    debit.transferPairId = credit.id;
    credit.transferPairId = debit.id;
  }
}

/** Generate a full scenario dataset for a profile, anchored to `now`. The
 *  result drops straight into a `MemoryRepositoryData` seed. */
export function generateScenarioData(
  profile: DemoProfile,
  opts: GenerateOptions,
): ScenarioData {
  const categories: Category[] = profile.categories.map((c) => ({ ...c }));

  const start = new Date(opts.now);
  start.setFullYear(start.getFullYear() - opts.yearsBack);

  const engine: Engine = {
    rng: new Rng(opts.seed),
    start,
    now: new Date(opts.now),
    catId: categoryByName(categories),
    txns: [],
    counter: 0,
  };

  for (const account of profile.accounts) {
    const balance = profile.openingBalances[account.id] ?? 0;
    if (balance === 0) continue;
    emit(engine, {
      datetime: datetimeString(start, HMS(0, 0, 0)),
      type: "income",
      amount: balance,
      accountId: account.id,
      merchant: "Opening Balance",
    });
  }

  for (const stream of profile.incomeStreams) emitIncome(engine, stream);
  for (const bill of profile.fixedBills) emitFixedBill(engine, bill);
  for (const bill of profile.variableBills) emitVariableBill(engine, bill);
  for (const spend of profile.variableExpenses)
    emitVariableExpense(engine, spend);
  for (const spend of profile.occasionalExpenses) emitOccasional(engine, spend);
  for (const transfer of profile.transfers) emitTransfer(engine, transfer);

  engine.txns.sort((a, b) =>
    a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0,
  );

  return {
    accounts: profile.accounts.map((a) => ({ ...a })),
    categories,
    transactions: engine.txns,
  };
}
