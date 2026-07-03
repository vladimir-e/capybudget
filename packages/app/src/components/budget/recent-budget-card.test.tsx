import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecentBudget } from "@capybudget/core";
import { RecentBudgetCard } from "./recent-budget-card";

const budget: RecentBudget = {
  path: "/Users/vlad/Budgets/Household",
  name: "Household",
  lastOpened: "2026-01-01T00:00:00.000Z",
};

afterEach(cleanup);

describe("RecentBudgetCard accessibility", () => {
  it("exposes open and remove as two distinct, separately-named buttons", () => {
    render(<RecentBudgetCard budget={budget} onOpen={() => {}} onRemove={() => {}} />);

    const open = screen.getByRole("button", { name: "Open Household" });
    const remove = screen.getByRole("button", { name: "Remove Household from recents" });

    expect(open).not.toBe(remove);
    // Neither control may nest the other — a button inside a button collapses in
    // the accessibility tree, which is what left the row openable only as Remove.
    expect(open.contains(remove)).toBe(false);
    expect(remove.contains(open)).toBe(false);
  });

  it("opens on activation without removing, and removes without opening", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<RecentBudgetCard budget={budget} onOpen={onOpen} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: "Open Household" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(budget.path);
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove Household from recents" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(budget.path);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens from the keyboard (the row is a real button)", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<RecentBudgetCard budget={budget} onOpen={onOpen} onRemove={() => {}} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Open Household" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(budget.path);
  });
});
