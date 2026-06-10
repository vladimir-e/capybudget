import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImportTransaction } from "@capybudget/core";
import type { StagingStore } from "@capybudget/intelligence";

// The heavy table/mapping subtrees (CategorySelector, AccountSelector, …) aren't
// what this test exercises — the merge race wiring is.
vi.mock("./import-table", () => ({ ImportTable: () => null }));
vi.mock("./import-mapping", () => ({ ImportMappingRows: () => null }));

const { merge, flushWriteBack, dataReturn } = vi.hoisted(() => ({
  merge: vi.fn(),
  flushWriteBack: vi.fn(async () => {}),
  dataReturn: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-import-merge", () => ({ useImportMerge: () => ({ merge }) }));
vi.mock("@/hooks/use-import-data", () => ({ useImportData: () => dataReturn }));

import { ImportPreview } from "./import-preview";

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
  flushWriteBack.mockClear();
  Object.assign(dataReturn, {
    transactions: [TXN],
    selectedIds: new Set(["imp-1"]),
    setSelectedIds: vi.fn(),
    accountMapping: {},
    loading: false,
    handleUpdate: vi.fn(),
    handleAccountMappingChange: vi.fn(),
    flushWriteBack,
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
      return { transactionCount: 1, accountsCreated: 0 };
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
});
