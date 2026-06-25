import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BudgetLoading } from "./budget-loading";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BudgetLoading", () => {
  it("exposes a status region for assistive tech immediately", () => {
    render(<BudgetLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("holds the visible indicator back, then reveals it on a slow load", () => {
    vi.useFakeTimers();
    render(<BudgetLoading />);
    const status = screen.getByRole("status");

    // Before the delay the mascot isn't painted yet.
    expect(status.querySelector("img")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(status.querySelector("img")).not.toBeNull();
  });

  it("clears its timer on unmount — a fast load fires no late state update", () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<BudgetLoading />);
    // Fast load: gone before the indicator delay elapses.
    unmount();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    // A leaked timer would setState on the unmounted component → React act/
    // update-on-unmounted warning. None means clearTimeout did its job.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
