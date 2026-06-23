import "@/test/journeys/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { renderApp } from "@/test/render-app";
import { makeAccount, makeTransaction } from "@/test/factories";

// Full-app proof for the UI/hook seams the core simulation can't reach — where
// two of the reported multi-currency bugs lived. Core asserts the math; this
// asserts the real form/hook/render path resolves and stamps rates correctly,
// end to end, against a RUB-default budget with a foreign IDR account.
//
// Budget meta (RUB default) is seeded through an in-memory file system so the
// shared budget-file query's readTextFile round-trips, the same way
// lifted-layout.test.tsx does. Without this the app falls back to the USD
// default and nothing here is multi-currency. The store is reset per test.

const BUDGET_PATH = "/test-budget";
const fsStore = new Map<string, string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const content = fsStore.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fsStore.set(path, content);
  }),
  rename: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(async (path: string) => fsStore.has(path)),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// A RUB-default budget written to budget.json. IDR is left out of the map on
// purpose: creating the IDR account is what must seed it (P1#1).
function seedRubBudget() {
  fsStore.set(
    `${BUDGET_PATH}/budget.json`,
    JSON.stringify({
      schemaVersion: 4,
      name: "Test Budget",
      defaultCurrency: "RUB",
      currencies: { RUB: { decimals: 0, symbolPosition: "after" } },
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    }),
  );
}

beforeEach(() => {
  fsStore.clear();
  seedRubBudget();
});

afterEach(() => {
  fsStore.clear();
});

const TIMEOUT = 30_000;

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

/** The budget meta (RUB default) loads async from the mocked fs, so on first
 *  paint the currency context is still the USD fallback. Wait until net worth
 *  renders in ₽ — the signal that RUB is the resolved default — before asserting
 *  anything that turns on the default currency (native balances, badges). */
async function waitForRubDefault() {
  const sidebar = screen.getByRole("complementary", { name: "Accounts" });
  await waitFor(() => {
    expect(within(sidebar).getByText("Net Worth").parentElement!.parentElement!.textContent).toContain("₽");
  });
}

/** Open the transaction form via the shell toggle and wait for focus. Both the
 *  toggle and the empty-state inline prompt share the accessible name "Add
 *  transaction"; the toggle is the one whose visible text is "New Transaction". */
async function openTransactionForm(user: UserEvent): Promise<HTMLInputElement> {
  const toggle = screen
    .getAllByRole("button", { name: "Add transaction" })
    .find((b) => b.textContent?.includes("New Transaction"))!;
  await user.click(toggle);
  const amountInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
  await waitFor(() => expect(amountInput).toHaveFocus());
  return amountInput;
}

/** The cross-currency "Received amount" input — the form doesn't associate the
 *  label with the control, so reach it through the label's wrapper. */
function receivedInput(): HTMLInputElement {
  return screen.getByText("Received amount").parentElement!.querySelector("input")!;
}

/** Pick an account in an AccountSelector trigger (a Popover+cmdk, not a native
 *  combobox): click the trigger, then the option by account name. */
async function pickAccount(user: UserEvent, trigger: HTMLElement, accountName: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: new RegExp(accountName) }));
}

/** Create an account through the sidebar dialog, choosing a foreign currency. */
async function createForeignAccount(
  user: UserEvent,
  opts: { name: string; currencyCode: string; currencyName: string; openingBalance?: string },
) {
  const sidebar = screen.getByRole("complementary", { name: "Accounts" });
  await user.click(within(sidebar).getByRole("button", { name: /add account/i }));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByLabelText("Name"), opts.name);

  await user.click(document.getElementById("account-currency")!);
  await user.type(await screen.findByRole("combobox"), opts.currencyCode);
  await user.click(await screen.findByText(opts.currencyName));

  if (opts.openingBalance) {
    await user.type(within(dialog).getByLabelText("Opening Balance"), opts.openingBalance);
  }

  await user.click(within(dialog).getByRole("button", { name: "Create Account" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

describe("Multi-currency journeys", () => {
  it("P1#1: a new foreign account seeds its rate — holdings value at the seed rate, never 1:1, without opening Settings", async () => {
    const { user, repo } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitForApp();

    // RUB default. Create an IDR account with a 16,000,000 IDR opening balance.
    // At the bundled seed rate (RUB 91 / IDR 16000 per USD → 0.0056875 RUB/IDR)
    // that is 91,000 ₽. A silent 1:1 would read 16,000,000 ₽ instead.
    await createForeignAccount(user, {
      name: "Jago Wallet",
      currencyCode: "IDR",
      currencyName: "Indonesian Rupiah",
      openingBalance: "16000000",
    });

    // The opening balance landed as a native IDR transaction, seed-stamped.
    await waitFor(() => {
      expect(repo.data.transactions).toHaveLength(1);
    });
    expect(repo.data.accounts[0].currency).toBe("IDR");
    expect(repo.data.transactions[0].amount).toBe(1_600_000_000); // 16,000,000 IDR in cents
    // It carries the seed rate — not empty (empty would value 1:1).
    expect(repo.data.transactions[0].fxRate).toBeCloseTo(91 / 16000, 12);

    // Net worth values the holding at the seed rate. RUB is symbol-after,
    // zero-decimal: "91,000 ₽". Crucially NOT the 1:1 "16,000,000 ₽". (The
    // account row itself now shows the native Rp16,000,000, so scope the 1:1
    // guard to the net-worth callout where the bug lived.)
    const sidebar = screen.getByRole("complementary", { name: "Accounts" });
    const netWorth = within(sidebar).getByText("Net Worth").parentElement!.parentElement!;
    await waitFor(() => {
      expect(netWorth.textContent).toContain("91,000");
    });
    expect(netWorth.textContent).not.toContain("16,000,000");
  }, TIMEOUT);

  it("P1#4: the owner's repro — editing the received IDR amount from the inflow row leaves the RUB balance correct, not swung negative by millions", async () => {
    // RUB checking with a starting balance, plus an IDR account. Transfer
    // 10,000 RUB → IDR, then open the transfer FROM THE IDR (inflow) row, change
    // only the received amount, and save. The from-leg RUB amount must stay
    // -10,000 ₽ — the bug clobbered it with the inflow magnitude (millions of IDR
    // cents), swinging the RUB balance violently negative.
    const rub = makeAccount({ id: "rub", name: "Tinkoff", currency: "RUB" });
    const idr = makeAccount({ id: "idr", name: "Jago", currency: "IDR" });
    const opening = makeTransaction({
      id: "open",
      type: "income",
      amount: 10_000_000, // 100,000 ₽ opening balance (default → no stamp)
      accountId: "rub",
      categoryId: "",
      merchant: "Opening Balance",
      datetime: "2026-02-01T09:00:00.000Z",
    });

    const { user, repo } = await renderApp({
      seed: { accounts: [rub, idr], categories: [], transactions: [opening] },
    });
    await waitForApp();

    // ── Create the transfer: 10,000 RUB → 1,758,000 IDR ──
    const amountInput = await openTransactionForm(user);
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    await user.type(amountInput, "10000");

    // From = Tinkoff (RUB), To = Jago (IDR).
    await pickAccount(user, screen.getByRole("button", { name: /Select account/ }), "Tinkoff");
    await pickAccount(user, screen.getByRole("button", { name: /^To…$/ }), "Jago");

    // Cross-currency → a received (IDR) field appears. Set the real landed amount.
    await screen.findByText("Received amount");
    await user.clear(receivedInput());
    await user.type(receivedInput(), "1758000");
    await user.keyboard("{Enter}");

    // Both legs persisted; RUB from-leg is -10,000 ₽ = -1,000,000 cents.
    await waitFor(() => {
      expect(repo.data.transactions.filter((t) => t.type === "transfer")).toHaveLength(2);
    });
    const rubLeg = () => repo.data.transactions.find((t) => t.accountId === "rub" && t.type === "transfer")!;
    const idrLeg = () => repo.data.transactions.find((t) => t.accountId === "idr" && t.type === "transfer")!;
    expect(rubLeg().amount).toBe(-1_000_000);
    expect(idrLeg().amount).toBe(175_800_000); // 1,758,000 IDR in cents

    // ── Edit FROM THE IDR (inflow) row ──
    // Navigate to the IDR account so its inflow leg is the visible transfer row.
    await user.click(screen.getAllByText("Jago").find((el) => el.closest("a"))!);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Jago" })).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    const transferRow = within(table).getByText("Transfer").closest("tr")!;
    await user.click(within(transferRow).getByRole("button")); // row action menu
    await user.click(await screen.findByRole("menuitem", { name: /edit/i }));

    // The editor seeds the received (IDR) field from the inflow leg regardless of
    // which row opened it. Change only the received amount to 1,800,000 IDR.
    await screen.findByText("Received amount");
    await waitFor(() => expect(receivedInput().value).not.toBe(""));
    await user.clear(receivedInput());
    await user.type(receivedInput(), "1800000");
    await user.keyboard("{Enter}");

    // ── The crux: RUB from-leg is STILL -10,000 ₽, not clobbered to millions ──
    await waitFor(() => {
      expect(idrLeg().amount).toBe(180_000_000); // 1,800,000 IDR — the edit landed
    });
    expect(rubLeg().amount).toBe(-1_000_000); // UNCHANGED — the corruption guard
    expect(rubLeg().amount).not.toBe(-180_000_000);

    // RUB account balance reconciles: 100,000 opening − 10,000 transfer = 90,000 ₽,
    // NOT swung negative by millions.
    const rubNative = repo.data.transactions
      .filter((t) => t.accountId === "rub")
      .reduce((s, t) => s + t.amount, 0);
    expect(rubNative).toBe(9_000_000);
  }, TIMEOUT);

  it("displays each sidebar account balance in its own currency while the net-worth aggregate stays in the default", async () => {
    // RUB default + an IDR account. The RUB row reads in ₽, the IDR row in its
    // native Rp (NOT converted to ₽), and the net-worth rollup — which can't sum
    // native amounts across currencies — stays in ₽.
    const rub = makeAccount({ id: "rub", name: "Tinkoff", currency: "RUB" });
    const idr = makeAccount({ id: "idr", name: "Jago", currency: "IDR", type: "cash", sortOrder: 2 });
    const rubOpen = makeTransaction({
      id: "rub-open", type: "income", amount: 10_000_000, // 100,000 ₽
      accountId: "rub", categoryId: "", merchant: "Opening Balance",
    });
    // 16,000,000 IDR native, seed-stamped (91/16000 RUB per IDR → 91,000 ₽).
    const idrOpen = makeTransaction({
      id: "idr-open", type: "income", amount: 1_600_000_000, fxRate: 91 / 16000,
      accountId: "idr", categoryId: "", merchant: "Opening Balance",
    });

    await renderApp({
      seed: { accounts: [rub, idr], categories: [], transactions: [rubOpen, idrOpen] },
    });
    await waitForApp();
    await waitForRubDefault();

    const sidebar = screen.getByRole("complementary", { name: "Accounts" });
    const idrRow = within(sidebar).getAllByText("Jago").find((el) => el.closest("a"))!.closest("a")!;
    const rubRow = within(sidebar).getAllByText("Tinkoff").find((el) => el.closest("a"))!.closest("a")!;

    // IDR row is native: "Rp16,000,000", never the converted "91,000 ₽".
    expect(idrRow.textContent).toContain("Rp16,000,000");
    expect(idrRow.textContent).not.toContain("₽");
    // RUB row in ₽.
    expect(rubRow.textContent).toContain("₽");

    // Net worth aggregate (100,000 + 91,000 = 191,000 ₽) stays in the default,
    // and never leaks the un-converted IDR magnitude.
    const netWorth = within(sidebar).getByText("Net Worth").parentElement!.parentElement!;
    expect(netWorth.textContent).toContain("₽");
    expect(netWorth.textContent).not.toContain("16,000,000");
  }, TIMEOUT);

  it("badges accounts and transaction rows with their currency in a multi-currency budget", async () => {
    const rub = makeAccount({ id: "rub", name: "Tinkoff", currency: "RUB" });
    const idr = makeAccount({ id: "idr", name: "Jago", currency: "IDR", type: "cash", sortOrder: 2 });
    const idrTxn = makeTransaction({
      id: "idr-exp", type: "expense", amount: -50_000_000, fxRate: 91 / 16000,
      accountId: "idr", categoryId: "", merchant: "Warung",
    });

    const { user } = await renderApp({
      seed: { accounts: [rub, idr], categories: [], transactions: [idrTxn] },
    });
    await waitForApp();
    await waitForRubDefault();

    // Sidebar: the IDR account name carries an "IDR" badge, the RUB one "RUB".
    const sidebar = screen.getByRole("complementary", { name: "Accounts" });
    const idrRow = within(sidebar).getAllByText("Jago").find((el) => el.closest("a"))!.closest("a")!;
    const rubRow = within(sidebar).getAllByText("Tinkoff").find((el) => el.closest("a"))!.closest("a")!;
    expect(within(idrRow as HTMLElement).getByText("IDR")).toBeInTheDocument();
    expect(within(rubRow as HTMLElement).getByText("RUB")).toBeInTheDocument();

    // Transaction list (all-accounts view): the IDR row carries an "IDR" badge
    // by its account — not by the amount, which already shows the Rp symbol.
    const table = screen.getByRole("table");
    const txnRow = within(table).getByText("Warung").closest("tr")!;
    expect(within(txnRow).getByText("IDR")).toBeInTheDocument();

    // On a single-account page the account column is hidden, so the per-row
    // badge doesn't show — the page is already scoped to one currency.
    await user.click(idrRow);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Jago" })).toBeInTheDocument();
    });
    const accountTable = screen.getByRole("table");
    const accountTxnRow = within(accountTable).getByText("Warung").closest("tr")!;
    expect(within(accountTxnRow).queryByText("IDR")).not.toBeInTheDocument();
  }, TIMEOUT);

  it("renders no currency badge when every account is in the budget default", async () => {
    // A single-currency (RUB-only) budget: no account is foreign, so the badges
    // never appear and the surface stays as it was before the display pass.
    const rub = makeAccount({ id: "rub", name: "Tinkoff", currency: "RUB" });
    const txn = makeTransaction({
      id: "exp", type: "expense", amount: -150_000, accountId: "rub",
      categoryId: "", merchant: "Pyaterochka",
    });

    const { user } = await renderApp({
      seed: { accounts: [rub], categories: [], transactions: [txn] },
    });
    await waitForApp();
    await waitForRubDefault();

    const sidebar = screen.getByRole("complementary", { name: "Accounts" });
    expect(within(sidebar).queryByText("RUB")).not.toBeInTheDocument();

    const rubRow = within(sidebar).getAllByText("Tinkoff").find((el) => el.closest("a"))!.closest("a")!;
    await user.click(rubRow);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Tinkoff" })).toBeInTheDocument();
    });
    const table = screen.getByRole("table");
    const txnRow = within(table).getByText("Pyaterochka").closest("tr")!;
    expect(within(txnRow).queryByText("RUB")).not.toBeInTheDocument();
  }, TIMEOUT);

  it("P2: entering an expense into a foreign account shows that account's currency symbol, not the budget default's", async () => {
    // RUB default budget, one IDR account (auto-selected as the sole account).
    // Opening the form must show the IDR "Rp" on the amount field, never "₽".
    const idr = makeAccount({ id: "idr", name: "Jago", currency: "IDR" });
    const { user } = await renderApp({
      seed: { accounts: [idr], categories: [], transactions: [] },
    });
    await waitForApp();

    const amountInput = await openTransactionForm(user);

    // The amount field is wrapped with its currency symbol.
    const amountField = amountInput.closest("div")!;
    await waitFor(() => {
      expect(within(amountField).getByText("Rp")).toBeInTheDocument();
    });
    expect(within(amountField).queryByText("₽")).not.toBeInTheDocument();
  }, TIMEOUT);
});
