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

    // Fast load (unmounts before the delay) would never paint the mascot.
    expect(status.querySelector("img")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(status.querySelector("img")).not.toBeNull();
  });
});
