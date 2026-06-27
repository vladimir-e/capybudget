import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  formatDefaultsFor,
  type Account,
  type Transaction,
  type CurrencySettings,
  type DateRange,
} from "@capybudget/core";
import { makeAccount, makeTransaction } from "@/test/factories";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { validateTabSearch, useAnalyticsStore, type TabId } from "@/stores/analytics-store";
import { AnalyticsView } from "./analytics-view";

// The unrealized-FX stat now lives in the shared summary strip, gated to the
// net-worth tab. THE invariant carries over: a USD-only budget shows the plain
// 3-stat strip. The worked example (a ruble account whose stamp ≠ today's rate)
// lights up a 4th stat with the right sign and magnitude — but only on the
// net-worth tab, and only while the window reaches the present (spot is a
// today's-rate number).

let mockAccounts: Account[] = [];
let mockTransactions: Transaction[] = [];

vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => ({ data: mockAccounts }),
  useCategories: () => ({ data: [] }),
  useTransactions: () => ({ data: mockTransactions }),
}));

// The active tab lives in the URL now, so mount AnalyticsView under a router
// matching the real route id and drive the tab via the `?tab=` param. Per-tab
// period state still lives in the store, set per-test for the tab under test.
function makeRouter(initialEntry: string) {
  const rootRoute = createRootRoute();
  const budgetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/budget",
    validateSearch: (search: Record<string, unknown>) => ({
      path: (search.path as string) ?? "",
      name: (search.name as string) ?? "Budget",
    }),
  });
  const shellRoute = createRoute({ getParentRoute: () => budgetRoute, id: "_shell" });
  const categoriesRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "/categories",
    validateSearch: validateTabSearch,
    component: AnalyticsView,
  });
  const routeTree = rootRoute.addChildren([
    budgetRoute.addChildren([shellRoute.addChildren([categoriesRoute])]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

function renderWithRouter(
  router: ReturnType<typeof makeRouter>,
  currencies: Record<string, CurrencySettings> | undefined,
) {
  const config: CurrencyConfig = {
    currency: "USD",
    currencies,
    ...formatDefaultsFor("USD"),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <CurrencyContext.Provider value={config}>
          <RouterProvider router={router} />
        </CurrencyContext.Provider>
      </QueryClientProvider>,
    ),
    router,
  };
}

async function renderView(
  currencies: Record<string, CurrencySettings> | undefined,
  tab: TabId,
  range: DateRange,
) {
  useAnalyticsStore.getState().setPeriod(tab, "custom", range);
  const router = makeRouter(`/budget/categories?path=/test&name=Test&tab=${tab}`);
  await router.load();
  return renderWithRouter(router, currencies);
}

// A window whose end is in the future, so the stat's today-statement is honest
// regardless of the wall clock when the suite runs.
const currentRange: DateRange = {
  start: new Date(new Date().getFullYear() - 1, 0, 1),
  end: new Date(new Date().getFullYear() + 1, 0, 1),
};

const RUB_CURRENCIES: Record<string, CurrencySettings> = {
  USD: formatDefaultsFor("USD"),
  RUB: { ...formatDefaultsFor("RUB"), rate: 0.011, rateSource: "manual" },
};

// Default USD, a ruble account: +100,000 ₽ stamped at 0.016 ($1,600 cost),
// worth $1,100 today at a manual 0.011 rate — a −$500 unrealized FX loss.
const rubAccount = makeAccount({ id: "acc-rub", name: "Tinkoff", currency: "RUB" });
const rubTxns = [
  makeTransaction({
    id: "r1", accountId: "acc-rub", type: "income", amount: 10_000_000,
    fxRate: 0.016, datetime: `${new Date().getFullYear()}-01-15T12:00:00.000Z`,
  }),
];

beforeEach(() => {
  useAnalyticsStore.setState({ netWorthExcludedIds: new Set() });
});

afterEach(() => {
  cleanup();
  mockAccounts = [];
  mockTransactions = [];
});

describe("AnalyticsView — summary-strip FX stat", () => {
  it("(THE invariant) a USD-only budget shows the plain 3-stat strip on the net-worth tab", async () => {
    mockAccounts = [makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" })];
    mockTransactions = [
      makeTransaction({ id: "u1", accountId: "acc-usd", type: "income", amount: 500_00, datetime: `${new Date().getFullYear()}-01-15T12:00:00.000Z` }),
    ];
    await renderView({ USD: formatDefaultsFor("USD") }, "netWorth", currentRange);

    expect(screen.queryByRole("button", { name: "What is this?" })).not.toBeInTheDocument();
  });

  it("shows the −$500 worked example on the net-worth tab with a foreign account + current range", async () => {
    mockAccounts = [rubAccount];
    mockTransactions = rubTxns;
    await renderView(RUB_CURRENCIES, "netWorth", currentRange);
    const user = userEvent.setup();

    // A loss, so the sign-aware label reads "Currency loss".
    expect(screen.getByText("Currency loss")).toBeInTheDocument();
    // The −$500 loss, rendered with the minus glyph in the expense token.
    expect(screen.getByText("−$500.00")).toBeInTheDocument();
    // The cost → spot relation moved into the tooltip — hover to surface it.
    await user.hover(screen.getByRole("button", { name: "What is this?" }));
    expect(
      await screen.findByText("$1,600.00 in → $1,100.00 now"),
    ).toBeInTheDocument();
  });

  it("hides the FX stat when scrubbed to a historical range (spot is a today statement)", async () => {
    mockAccounts = [rubAccount];
    mockTransactions = rubTxns;
    await renderView(RUB_CURRENCIES, "netWorth", { start: new Date(2019, 0, 1), end: new Date(2020, 0, 1) });

    expect(screen.queryByRole("button", { name: "What is this?" })).not.toBeInTheDocument();
  });

  it("never shows the FX stat on a non-net-worth tab, even with a foreign account + current range", async () => {
    mockAccounts = [rubAccount];
    mockTransactions = rubTxns;
    await renderView(RUB_CURRENCIES, "spending", currentRange);

    expect(screen.queryByRole("button", { name: "What is this?" })).not.toBeInTheDocument();
  });
});

describe("AnalyticsView — URL-owned active tab", () => {
  it("a tab click writes ?tab=, preserves path/name, and pushes history", async () => {
    mockAccounts = [makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" })];
    mockTransactions = [];
    const user = userEvent.setup();
    const { router } = await renderView(undefined, "spending", currentRange);

    await user.click(screen.getByRole("button", { name: "Net Worth" }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        tab: "netWorth",
        path: "/test",
        name: "Test",
      });
    });

    // The switch pushed an entry, so back returns to the tab we came from.
    router.history.back();
    await waitFor(() => {
      expect((router.state.location.search as { tab?: string }).tab).toBe("spending");
    });
  });
});

describe("AnalyticsView — tab search validation", () => {
  it("renders Spending and injects no tab key when the param is absent", async () => {
    mockAccounts = [makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" })];
    mockTransactions = [];
    const router = makeRouter("/budget/categories?path=/test&name=Test");
    await router.load();
    renderWithRouter(router, undefined);

    expect(screen.getByRole("button", { name: "Spending" })).toHaveClass("border-brand");
    expect(router.state.location.search).not.toHaveProperty("tab");
  });

  it("strips an unknown tab value and falls back to Spending", async () => {
    mockAccounts = [makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" })];
    mockTransactions = [];
    const router = makeRouter("/budget/categories?path=/test&name=Test&tab=garbage");
    await router.load();
    renderWithRouter(router, undefined);

    // Defensive read shows Spending immediately, before the URL self-heals.
    expect(screen.getByRole("button", { name: "Spending" })).toHaveClass("border-brand");
    // The dead param is dropped from the URL (replace, so no history entry).
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("tab"));
  });
});

describe("AnalyticsView — period nav stays out of history", () => {
  it("stepping the period within a tab does not push a history entry", async () => {
    mockAccounts = [makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" })];
    // Transactions across several months so the period back arrow is enabled.
    mockTransactions = [
      makeTransaction({ id: "t1", accountId: "acc-usd", type: "expense", amount: 100_00, datetime: "2024-01-15T12:00:00.000Z" }),
      makeTransaction({ id: "t2", accountId: "acc-usd", type: "expense", amount: 100_00, datetime: "2024-06-15T12:00:00.000Z" }),
    ];
    useAnalyticsStore.getState().setPeriod("spending", "month", {
      start: new Date(2024, 5, 1),
      end: new Date(2024, 6, 1),
    });
    const router = makeRouter("/budget/categories?path=/test&name=Test&tab=spending");
    await router.load();
    const user = userEvent.setup();
    renderWithRouter(router, undefined);

    const back = screen.getByRole("button", { name: "Previous period" });
    await waitFor(() => expect(back).toBeEnabled());

    const indexBefore = router.state.location.state.__TSR_index;
    await user.click(back);

    // The store stepped to May; the router index — and thus history — held still.
    await waitFor(() => {
      expect(useAnalyticsStore.getState().tabs.spending.dateRange.start.getMonth()).toBe(4);
    });
    expect(router.state.location.state.__TSR_index).toBe(indexBefore);
  });
});
