import "@/test/journeys/setup";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { isMac } from "@/lib/platform";

const MOD = isMac ? "Meta" : "Control";

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

function hold(key: string, type: "keydown" | "keyup") {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { key }));
  });
}

const TIMEOUT = 15_000;

describe("Cmd-hold shortcut overlay", () => {
  afterEach(() => vi.useRealTimers());

  it("reveals every wired shortcut badge on hold and hides them on release", async () => {
    // Boot under real timers — the router/query layer needs them.
    await renderApp();
    await waitForApp();
    // Switch to fake timers only to drive the hold delay deterministically.
    vi.useFakeTimers();

    // Each rail item carries a digit chip; the Capy pill carries the full chord.
    const railDigits = ["1", "2", "3", ","];
    const railBadges = railDigits.map((d) =>
      // The digit appears only inside the decorative kbd chip.
      screen.getByText(d, { selector: "kbd[aria-hidden='true']" }),
    );
    const pillBadge = screen.getByText(isMac ? "⌘I" : "Ctrl+I", {
      selector: "kbd[aria-hidden='true']",
    });
    const all = [...railBadges, pillBadge];

    // Resting: hidden, and absolutely positioned so they never reflow siblings.
    for (const b of all) {
      expect(b).toHaveClass("opacity-0");
      expect(b).toHaveClass("absolute");
      expect(b).not.toHaveClass("opacity-100");
    }

    // Hold the modifier past the reveal delay.
    hold(MOD, "keydown");
    act(() => vi.advanceTimersByTime(250));
    for (const b of all) expect(b).toHaveClass("opacity-100");

    // Release.
    hold(MOD, "keyup");
    for (const b of all) expect(b).not.toHaveClass("opacity-100");
  }, TIMEOUT);
});
