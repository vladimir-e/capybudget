import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ModHintProvider } from "@/components/budget/mod-hint-provider";
import { ModHintBadge } from "@/components/budget/mod-hint-badge";
import { isMac } from "@/lib/platform";

// The provider keys off the platform modifier. jsdom's UA is not a Mac, so the
// live code listens for "Control" here — dispatch the key the code is watching
// rather than mocking the platform, so the test exercises the real branch.
const MOD = isMac ? "Meta" : "Control";

function renderBadge() {
  render(
    <ModHintProvider>
      <ModHintBadge>X</ModHintBadge>
    </ModHintProvider>,
  );
  return screen.getByText("X");
}

function fire(type: "keydown" | "keyup", key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { key }));
  });
}

describe("ModHintProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reveals only after the hold delay elapses", () => {
    const badge = renderBadge();
    expect(badge).toHaveClass("opacity-0");
    expect(badge).not.toHaveClass("opacity-100");

    fire("keydown", MOD);
    expect(badge).not.toHaveClass("opacity-100"); // still waiting

    act(() => vi.advanceTimersByTime(250));
    expect(badge).toHaveClass("opacity-100");
  });

  it("never reveals on a quick chord (mod + key before the delay)", () => {
    const badge = renderBadge();
    fire("keydown", MOD);
    act(() => vi.advanceTimersByTime(100));
    fire("keydown", "n"); // ⌘N — cancels the pending reveal
    act(() => vi.advanceTimersByTime(500));
    expect(badge).not.toHaveClass("opacity-100");
  });

  it("hides again on modifier keyup", () => {
    const badge = renderBadge();
    fire("keydown", MOD);
    act(() => vi.advanceTimersByTime(250));
    expect(badge).toHaveClass("opacity-100");

    fire("keyup", MOD);
    expect(badge).not.toHaveClass("opacity-100");
  });

  it("resets on window blur (e.g. Cmd-Tab away)", () => {
    const badge = renderBadge();
    fire("keydown", MOD);
    act(() => vi.advanceTimersByTime(250));
    expect(badge).toHaveClass("opacity-100");

    act(() => window.dispatchEvent(new Event("blur")));
    expect(badge).not.toHaveClass("opacity-100");
  });
});
