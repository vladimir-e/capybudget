import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImportTransaction } from "@capybudget/core";
import type { StagingStore } from "@capybudget/intelligence";

// The heavy table/mapping subtrees (CategorySelector, AccountSelector, …) aren't
// what this test exercises — the merge race and dialog wiring are. The table
// mock exposes its Map-accounts trigger so the dialog plumbing is reachable.
vi.mock("./import-table", () => ({
  ImportTable: ({ onOpenAccountMapping }: { onOpenAccountMapping: () => void }) => (
    <button onClick={onOpenAccountMapping}>open account mapping</button>
  ),
}));
// The mapping rows are the reused element — both dialogs render the same
// component (source → target only). The stub surfaces what the preview wires
// into it: the source rows and a remap button that calls back so an
// edit-at-the-gate is observable.
vi.mock("./import-mapping", () => ({
  ImportMappingRows: ({
    sourceAccounts,
    accountMapping,
    onAccountMappingChange,
  }: {
    sourceAccounts: string[];
    accountMapping: Record<string, string>;
    onAccountMappingChange: (m: Record<string, string>) => void;
  }) => (
    <div data-testid="mapping-rows">
      {sourceAccounts.map((s) => (
        <div key={s}>
          <span>{s}</span>
          <button onClick={() => onAccountMappingChange({ ...accountMapping, [s]: "acct-2" })}>
            remap {s}
          </button>
        </div>
      ))}
    </div>
  ),
}));

const { merge, flushWriteBack, dataReturn } = vi.hoisted(() => ({
  merge: vi.fn(),
  flushWriteBack: vi.fn(async () => {}),
  dataReturn: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-import-merge", () => ({ useImportMerge: () => ({ merge }) }));
vi.mock("@/hooks/use-import-data", () => ({ useImportData: () => dataReturn }));
vi.mock("@/hooks/use-budget-data", () => ({ useTransactions: () => ({ data: [] }) }));

import { ImportPreview } from "./import-preview";
import { useImportStore } from "@/stores/import-store";
import type { Account } from "@capybudget/core";

function makeBudgetAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    name: "Account",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    currency: "USD",
    ...overrides,
  };
}

const TXN: ImportTransaction = {
  id: "imp-1",
  date: "2026-01-05",
  description: "COFFEE",
  amount: -450,
  type: "expense",
  sourceAccount: "",
  sourceCategory: "",
  merchant: "Coffee",
  accountId: "",
  targetAccountId: "",
  categoryId: "cat-1",
  categoryConfidence: "high",
  duplicate: false,
  duplicateConfidence: "",
};

beforeEach(() => {
  merge.mockReset();
  // mockReset (not mockClear) — it drops any per-test mockImplementation and
  // restores the original async no-op, so tests can't leak into each other.
  flushWriteBack.mockReset();
  Object.assign(dataReturn, {
    transactions: [TXN],
    selectedIds: new Set(["imp-1"]),
    setSelectedIds: vi.fn(),
    accountMapping: {},
    loading: false,
    skippedRowCount: 0,
    handleUpdate: vi.fn(),
    handleAccountMappingChange: vi.fn(),
    flushWriteBack,
    discard: vi.fn(),
    sourceAccounts: [],
    duplicateIds: new Set<string>(),
    possibleDuplicateCount: 0,
    uncategorizedCount: 0,
    lowConfidenceCount: 0,
    incompleteCount: 0,
    accounts: [],
    categories: [],
  });
});

function renderPreview(props: Partial<Parameters<typeof ImportPreview>[0]> = {}) {
  return render(
    <ImportPreview
      budgetPath="/b"
      staging={{} as StagingStore}
      rowsVersion={0}
      running={false}
      onStopRun={vi.fn(async () => {})}
      onEnrich={vi.fn()}
      onEnrichControl={vi.fn()}
      onRegisterDiscard={vi.fn()}
      onSelectionChange={vi.fn()}
      onCancelImport={vi.fn()}
      onMergeComplete={vi.fn()}
      {...props}
    />,
  );
}

describe("ImportPreview — run notes panel", () => {
  it("splits the duplicates copy between certain and possible matches", () => {
    Object.assign(dataReturn, {
      duplicateIds: new Set(["a", "b", "c", "d", "e", "f"]),
      possibleDuplicateCount: 2,
    });
    renderPreview();

    expect(
      screen.getByText(
        "4 duplicates detected — already unselected · 2 possible duplicates (close date match) — review before merging",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the plain copy when every duplicate is certain", () => {
    Object.assign(dataReturn, { duplicateIds: new Set(["a", "b"]), possibleDuplicateCount: 0 });
    renderPreview();

    expect(screen.getByText("2 duplicates detected — already unselected")).toBeInTheDocument();
    expect(screen.queryByText(/possible duplicate/)).toBeNull();
  });

  it("shows only the review copy when every duplicate is speculative", () => {
    Object.assign(dataReturn, { duplicateIds: new Set(["a"]), possibleDuplicateCount: 1 });
    renderPreview();

    expect(
      screen.getByText("1 possible duplicate (close date match) — review before merging"),
    ).toBeInTheDocument();
  });

  it("groups the duplicates and issues notes into one panel", () => {
    Object.assign(dataReturn, {
      duplicateIds: new Set(["a"]),
      possibleDuplicateCount: 0,
      uncategorizedCount: 3,
      lowConfidenceCount: 22,
    });
    renderPreview();

    const duplicates = screen.getByText("1 duplicate detected — already unselected");
    const issues = screen.getByText("3 uncategorized, 22 low confidence");
    expect(duplicates.closest("div")?.parentElement).toBe(issues.closest("div")?.parentElement);
  });

  it("hides the issues note while a run is in flight (counts still settling)", () => {
    Object.assign(dataReturn, { uncategorizedCount: 3, lowConfidenceCount: 22 });
    renderPreview({ running: true });

    expect(screen.queryByText(/uncategorized/)).toBeNull();
  });

  it("surfaces rows the staging read skipped", () => {
    Object.assign(dataReturn, { skippedRowCount: 3 });
    renderPreview();

    expect(
      screen.getByText("3 rows were skipped (couldn't be read)"),
    ).toBeInTheDocument();
  });

  it("shows no skipped note when nothing was dropped", () => {
    renderPreview();

    expect(screen.queryByText(/skipped/)).toBeNull();
  });
});

describe("ImportPreview — enrich control", () => {
  it("reports the enrichable count up and flushes edits before triggering enrich", async () => {
    const order: string[] = [];
    flushWriteBack.mockImplementation(async () => {
      order.push("flush");
    });
    const onEnrich = vi.fn(() => order.push("enrich"));
    const onEnrichControl = vi.fn();
    Object.assign(dataReturn, { incompleteCount: 7 });

    const { unmount } = renderPreview({ onEnrich, onEnrichControl });

    const control = onEnrichControl.mock.lastCall?.[0] as { count: number; run: () => void };
    expect(control.count).toBe(7);

    control.run();
    await waitFor(() => expect(onEnrich).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["flush", "enrich"]);

    unmount();
    expect(onEnrichControl).toHaveBeenLastCalledWith(null);
  });
});

describe("ImportPreview — account mapping dialog", () => {
  it("opens the Map-accounts dialog from the table's ACCOUNT-cell trigger", async () => {
    Object.assign(dataReturn, { sourceAccounts: ["BOFA CHK 1234"] });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "open account mapping" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Map accounts")).toBeInTheDocument();
    expect(within(dialog).getByTestId("mapping-rows")).toBeInTheDocument();
  });

  it("renders editable mapping rows in the confirmation", async () => {
    const mapped: ImportTransaction = {
      ...TXN,
      id: "imp-2",
      amount: -2500,
      sourceAccount: "BOFA CHK 1234",
      accountId: "acct-1",
    };
    Object.assign(dataReturn, {
      transactions: [mapped],
      selectedIds: new Set(["imp-2"]),
      sourceAccounts: ["BOFA CHK 1234"],
      accountMapping: { "BOFA CHK 1234": "acct-1" },
      accounts: [makeBudgetAccount({ id: "acct-1", name: "BofA Checking" })],
    });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getByTestId("mapping-rows");
    expect(within(rows).getByText("BOFA CHK 1234")).toBeInTheDocument();
  });

  it("hides source accounts whose rows are all deselected", async () => {
    // The gate must reflect what merges (selectedIds), not every staged source.
    Object.assign(dataReturn, {
      transactions: [
        { ...TXN, id: "imp-a", sourceAccount: "Chase", accountId: "acct-1" },
        { ...TXN, id: "imp-b", sourceAccount: "Wells Fargo", accountId: "acct-2" },
      ],
      selectedIds: new Set(["imp-a"]),
      sourceAccounts: ["Chase", "Wells Fargo"],
      accountMapping: { "Chase": "acct-1", "Wells Fargo": "acct-2" },
      accounts: [
        makeBudgetAccount({ id: "acct-1", name: "Chase Checking" }),
        makeBudgetAccount({ id: "acct-2", name: "Wells Savings" }),
      ],
    });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getByTestId("mapping-rows");
    expect(within(rows).getByText("Chase")).toBeInTheDocument();
    expect(within(rows).queryByText("Wells Fargo")).toBeNull();
  });

  it("shows only the total amount in the confirmation subtitle", async () => {
    Object.assign(dataReturn, {
      transactions: [{ ...TXN, id: "imp-2", amount: -2500 }],
      selectedIds: new Set(["imp-2"]),
    });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    // Amount only — the count lives in the title, no new-accounts sentence.
    expect(within(dialog).getByText(/This will add/)).toHaveTextContent(
      "This will add -$25.00 to your budget.",
    );
  });

  it("editing a mapping at the gate calls the mapping-change handler", async () => {
    const handleAccountMappingChange = vi.fn();
    Object.assign(dataReturn, {
      transactions: [{ ...TXN, id: "imp-2", sourceAccount: "BOFA CHK 1234", accountId: "acct-1" }],
      selectedIds: new Set(["imp-2"]),
      sourceAccounts: ["BOFA CHK 1234"],
      accountMapping: { "BOFA CHK 1234": "acct-1" },
      accounts: [makeBudgetAccount({ id: "acct-1", name: "BofA Checking" })],
      handleAccountMappingChange,
    });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "remap BOFA CHK 1234" }));

    expect(handleAccountMappingChange).toHaveBeenCalledWith({ "BOFA CHK 1234": "acct-2" });
  });

  it("warns about transfers that lost their counterpart, without listing them", async () => {
    // A lone transfer with no target and no opposite leg downgrades on merge.
    const orphan: ImportTransaction = {
      ...TXN,
      id: "imp-3",
      type: "transfer",
      amount: -5000,
      sourceAccount: "BOFA CHK 1234",
      accountId: "acct-1",
      categoryId: "",
    };
    Object.assign(dataReturn, {
      transactions: [orphan],
      selectedIds: new Set(["imp-3"]),
      sourceAccounts: ["BOFA CHK 1234"],
      accountMapping: { "BOFA CHK 1234": "acct-1" },
      accounts: [makeBudgetAccount({ id: "acct-1", name: "BofA Checking" })],
    });
    renderPreview();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/had no matching counterpart/)).toBeInTheDocument();
  });
});

describe("ImportPreview — merge gating", () => {
  it("disables Merge while a run is in flight", () => {
    renderPreview({ running: true });
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("stops + detaches the run before merge clears staging", async () => {
    const order: string[] = [];
    const onStopRun = vi.fn(async () => {
      order.push("stop");
    });
    merge.mockImplementation(async () => {
      order.push("merge");
      return { transactionCount: 1, accountsCreated: 0, stagingCleared: true };
    });
    const onMergeComplete = vi.fn();

    renderPreview({ onStopRun, onMergeComplete });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(onStopRun).toHaveBeenCalledTimes(1);
    // The run is torn down before the merge writes the budget + clears staging.
    expect(order).toEqual(["stop", "merge"]);
    expect(onMergeComplete).toHaveBeenCalledTimes(1);
  });

  it("discards the pending write-back before merge and invalidates only after it succeeds", async () => {
    const order: string[] = [];
    const discard = vi.fn(() => order.push("discard"));
    Object.assign(dataReturn, { discard });
    const genBefore = useImportStore.getState().stagingGeneration;
    merge.mockImplementation(async () => {
      order.push("merge");
      return { transactionCount: 1, accountsCreated: 0, stagingCleared: true };
    });

    renderPreview();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(discard).toHaveBeenCalledTimes(1);
    // discard drops the pending timer before the merge; the generation is bumped
    // only after a successful teardown — a merge that threw would leave it live.
    expect(order).toEqual(["discard", "merge"]);
    expect(useImportStore.getState().stagingGeneration).toBe(genBefore + 1);
  });

  it("leaves the generation live and doesn't complete when the merge throws", async () => {
    const onMergeComplete = vi.fn();
    const genBefore = useImportStore.getState().stagingGeneration;
    merge.mockImplementation(async () => {
      throw new Error("save failed");
    });

    renderPreview({ onMergeComplete });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    // A merge that threw before committing must leave the generation untouched —
    // the still-mounted preview's captured generation keeps persisting edits — and
    // must not report completion.
    expect(useImportStore.getState().stagingGeneration).toBe(genBefore);
    expect(onMergeComplete).not.toHaveBeenCalled();
  });

  it("stamps staging merged and still completes when the post-merge clear fails", async () => {
    const order: string[] = [];
    const writeState = vi.fn(async () => {
      order.push("mark");
    });
    const onMergeComplete = vi.fn(() => order.push("complete"));
    const genBefore = useImportStore.getState().stagingGeneration;
    merge.mockImplementation(async () => ({
      transactionCount: 1,
      accountsCreated: 0,
      stagingCleared: false,
    }));

    renderPreview({ staging: { writeState } as unknown as StagingStore, onMergeComplete });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    // The surviving staging is stamped merged so the next mount clears it instead
    // of resuming a double merge, the generation is still invalidated (marker
    // first), and the merge — which committed — still completes.
    expect(writeState).toHaveBeenCalledWith(expect.objectContaining({ merged: true }));
    expect(useImportStore.getState().stagingGeneration).toBe(genBefore + 1);
    expect(onMergeComplete).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["mark", "complete"]);
  });
});
