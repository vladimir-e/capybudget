import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeAccount, makeCategory } from "@/test/factories";
import { makeImportTransaction } from "@capybudget/core/test-factories";
import type { ImportTransaction, Account } from "@capybudget/core";
import { ImportTable } from "./import-table";
import type { ImportSortConfig } from "@/components/import/import-table-utils";

// Account list spans several types so group ordering is observable.
const CHECKING = makeAccount({ id: "acct-checking", name: "BofA Checking", type: "checking" });
const SAVINGS = makeAccount({ id: "acct-savings", name: "BofA Savings", type: "savings" });
const BROKERAGE = makeAccount({ id: "acct-brokerage", name: "Fidelity", type: "asset" });
const ACCOUNTS: Account[] = [CHECKING, SAVINGS, BROKERAGE];

const sort: ImportSortConfig = { column: "date", direction: "desc" };

/** Render ImportTable over the given rows with inert handlers. */
function renderTable(
  transactions: ImportTransaction[],
  opts: {
    selectedIds?: Set<string>;
    duplicateIds?: Set<string>;
    accountMapping?: Record<string, string>;
    onOpenAccountMapping?: () => void;
    searchActive?: boolean;
  } = {},
) {
  return render(
    <ImportTable
      transactions={transactions}
      searchActive={opts.searchActive ?? false}
      sort={sort}
      onSortChange={vi.fn()}
      selectedIds={opts.selectedIds ?? new Set(transactions.map((t) => t.id))}
      onToggleSelect={vi.fn()}
      onToggleAll={vi.fn()}
      allSelected
      indeterminate={false}
      onUpdateTransaction={vi.fn()}
      categories={[makeCategory({ id: "cat-1", name: "Groceries", group: "Daily Living" })]}
      accounts={ACCOUNTS}
      accountMapping={opts.accountMapping ?? {}}
      onOpenAccountMapping={opts.onOpenAccountMapping ?? vi.fn()}
      duplicateIds={opts.duplicateIds ?? new Set()}
    />,
  );
}

/** The wrapper div holding a transfer row's account dropdown — the element that
 *  carries the unset-outline classes (the ring is applied via arbitrary
 *  variants on this wrapper, per the transaction-form convention). Walks up from
 *  the dropdown trigger to the nearest ancestor styling the selector. */
function selectorWrapper(triggerName: RegExp): HTMLElement {
  const trigger = screen.getByRole("button", { name: triggerName });
  let el: HTMLElement | null = trigger.parentElement;
  while (el && !el.className.includes("[&>div]:w-full")) el = el.parentElement;
  if (!el) throw new Error("selector wrapper not found");
  return el;
}

describe("ImportTable — duplicate badge tiers", () => {
  const dupRow = (duplicateConfidence: string) =>
    makeImportTransaction({ id: "imp-1", duplicate: true, duplicateConfidence });
  const dupOpts = { duplicateIds: new Set(["imp-1"]), selectedIds: new Set<string>() };

  it("shows the blue badge for an exact-rule duplicate", () => {
    renderTable([dupRow("high")], dupOpts);

    const badge = screen.getByTitle("Duplicate of an existing transaction");
    expect(badge.innerHTML).toContain("text-blue-500");
    expect(badge.closest("tr")?.className).toContain("bg-blue-500/5");
  });

  it("shows the amber possible-duplicate badge for a relaxed-window match", () => {
    renderTable([dupRow("low")], dupOpts);

    const badge = screen.getByTitle("Possible duplicate (close date match)");
    expect(badge.innerHTML).toContain("text-amber-500");
    expect(badge.closest("tr")?.className).toContain("bg-amber-500/5");
  });
});

describe("ImportTable — mapped account column", () => {
  it("shows only the mapped target's name — the raw import lives in the mapping dialog", () => {
    renderTable([makeImportTransaction({ id: "imp-1", sourceAccount: "BOFA CHK 1234" })], {
      accountMapping: { "BOFA CHK 1234": "acct-checking" },
    });

    expect(screen.getByText("BofA Checking")).toBeInTheDocument();
    expect(screen.queryByText("BOFA CHK 1234")).toBeNull();
    expect(screen.queryByText("new")).toBeNull();
  });

  it("keeps the imported name and tags it 'new' when merge would create the account", () => {
    renderTable([makeImportTransaction({ id: "imp-1", sourceAccount: "Monzo" })], {
      accountMapping: { Monzo: "__create__" },
    });

    expect(screen.getByText("Monzo")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
  });

  it("treats a missing mapping entry as create-on-merge too", () => {
    renderTable([makeImportTransaction({ id: "imp-1", sourceAccount: "Monzo" })]);
    expect(screen.getByText("new")).toBeInTheDocument();
  });

  it("opens the Map-accounts dialog when the cell is clicked", async () => {
    const user = userEvent.setup();
    const onOpenAccountMapping = vi.fn();
    renderTable([makeImportTransaction({ id: "imp-1", sourceAccount: "BOFA CHK 1234" })], {
      accountMapping: { "BOFA CHK 1234": "acct-checking" },
      onOpenAccountMapping,
    });

    await user.click(screen.getByRole("button", { name: "BofA Checking" }));
    expect(onOpenAccountMapping).toHaveBeenCalledTimes(1);
  });

  it("renders a plain 'none' (no trigger) for a row without a source account", () => {
    renderTable([makeImportTransaction({ id: "imp-1", sourceAccount: "" })]);

    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "none" })).toBeNull();
  });
});

describe("ImportTable — transfer counterpart dropdown", () => {
  it("outlines the dropdown when the transfer's account is unset", () => {
    renderTable([
      makeImportTransaction({
        id: "imp-1", type: "transfer", amount: 50000, targetAccountId: "",
      }),
    ]);

    // Unset inflow → placeholder "From account", wrapper carries the amber ring.
    const wrapper = selectorWrapper(/From account/);
    expect(wrapper.className).toContain("ring-amber-500/40");
    expect(wrapper.className).toContain("border-amber-500/60");
    // No text label — the indicator is purely the outline + placeholder wording.
    expect(screen.queryByText(/needs|missing|set account/i)).toBeNull();
  });

  it("does not outline the dropdown when the account is set", () => {
    renderTable([
      makeImportTransaction({
        id: "imp-1", type: "transfer", amount: 50000, targetAccountId: "acct-savings",
      }),
    ]);

    const wrapper = selectorWrapper(/BofA Savings/);
    expect(wrapper.className).not.toContain("ring-amber");
    expect(wrapper.className).not.toContain("border-amber");
  });

  it("uses the 'To account' placeholder for an unset outflow", () => {
    renderTable([
      makeImportTransaction({
        id: "imp-1", type: "transfer", amount: -50000, targetAccountId: "",
      }),
    ]);

    const wrapper = selectorWrapper(/To account/);
    expect(wrapper.className).toContain("ring-amber-500/40");
  });

  it("keeps the account-list order unchanged (standard type grouping)", async () => {
    const user = userEvent.setup();
    renderTable([
      makeImportTransaction({
        id: "imp-1", type: "transfer", amount: 50000, targetAccountId: "",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /From account/ }));

    // Options render in the app's standard ACCOUNT_TYPE_ORDER (checking, then
    // savings, then asset) — the model's pick must never reorder this list.
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    const checking = options.indexOf("BofA Checking");
    const savings = options.indexOf("BofA Savings");
    const fidelity = options.indexOf("Fidelity");
    expect(checking).toBeGreaterThanOrEqual(0);
    expect(checking).toBeLessThan(savings);
    expect(savings).toBeLessThan(fidelity);
  });
});

describe("ImportTable — empty state", () => {
  it("suggests adjusting the search only when a search filtered the rows out", () => {
    renderTable([], { searchActive: true });

    expect(screen.getByText("No transactions found")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your search.")).toBeInTheDocument();
  });

  it("shows a neutral message when no rows loaded at all", () => {
    renderTable([]);

    expect(screen.getByText("No transactions to import")).toBeInTheDocument();
    expect(screen.queryByText("Try adjusting your search.")).toBeNull();
  });
});
