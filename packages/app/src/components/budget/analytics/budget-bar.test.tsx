import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { BudgetRow } from "./monthly-budget-rows";
import { BudgetBar } from "./budget-bar";
import { TARGET_FRACTION } from "./budget-bar-geometry";

function row(p: Partial<BudgetRow>): BudgetRow {
  const assigned = p.assigned ?? null;
  const implicitTarget = p.implicitTarget ?? null;
  return {
    categoryId: p.categoryId ?? "c",
    assigned,
    spent: p.spent ?? 0,
    lastMonth: p.lastMonth ?? 0,
    avg3Month: p.avg3Month ?? 0,
    implicitTarget,
    effectiveTarget: assigned ?? implicitTarget,
    isImplicit: assigned === null && implicitTarget !== null,
  };
}

afterEach(cleanup);

// The spend fill is the only element with the `transition-all` class; the
// tinted zones reference the same color tokens, so target it by that class.
function fillOf(track: HTMLElement): HTMLElement {
  return track.querySelector(".transition-all") as HTMLElement;
}

describe("BudgetBar — rendering by state", () => {
  it("under an explicit target: green fill, solid divider, no over-text in label", () => {
    render(<BudgetBar row={row({ assigned: 10000, spent: 5000 })} />);
    const track = screen.getByRole("img", { name: /Spent \$50\.00 of \$100\.00 target/ });
    expect(track.getAttribute("aria-label")).not.toMatch(/over/i);

    // The fill is the income-green token at half the green-zone width.
    const fill = fillOf(track);
    expect(fill.getAttribute("style")).toMatch(/var\(--amount-income\)/);
    expect(parseFloat(fill.style.width)).toBeCloseTo((TARGET_FRACTION / 2) * 100, 5);

    // Explicit target → a SOLID divider line in the foreground token.
    const solid = document.querySelector('span[style*="solid"]') as HTMLElement;
    expect(solid).toBeTruthy();
    expect(solid.getAttribute("style")).toMatch(/var\(--foreground\)/);
  });

  it("over a target: red fill that crosses the divider, label says 'over'", () => {
    render(<BudgetBar row={row({ assigned: 10000, spent: 20000 })} />);
    const track = screen.getByRole("img", { name: /over target/ });
    const fill = fillOf(track);
    expect(fill.getAttribute("style")).toMatch(/var\(--amount-expense\)/);
    expect(parseFloat(fill.style.width)).toBeGreaterThan(TARGET_FRACTION * 100);
  });

  it("implicit target: dashed/ghosted divider", () => {
    render(<BudgetBar row={row({ implicitTarget: 10000, spent: 5000 })} />);
    const dashed = document.querySelector('span[style*="dashed"]') as HTMLElement;
    expect(dashed).toBeTruthy();
    expect(dashed.getAttribute("style")).toMatch(/var\(--muted-foreground\)/);
    // No solid foreground divider in the implicit case.
    expect(document.querySelector('span[style*="solid"]')).toBeNull();
  });

  it("renders a divider at the fixed target fraction", () => {
    render(<BudgetBar row={row({ assigned: 12345, spent: 1000 })} />);
    const divider = screen.getByRole("button", { name: /Budget: \$123\.45/ });
    expect(parseFloat(divider.style.left)).toBeCloseTo(TARGET_FRACTION * 100, 5);
  });

  it("implicit divider is labelled as an auto target", () => {
    render(<BudgetBar row={row({ implicitTarget: 8000, spent: 1000 })} />);
    expect(screen.getByRole("button", { name: /Auto target: \$80\.00/ })).toBeInTheDocument();
  });

  it("renders both historical pins with value labels", () => {
    render(
      <BudgetBar
        row={row({ implicitTarget: 11000, lastMonth: 9000, avg3Month: 11000, spent: 6000 })}
      />,
    );
    expect(screen.getByRole("button", { name: /Last month: \$90\.00/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3-mo avg: \$110\.00/ })).toBeInTheDocument();
  });

  it("untargeted: a calm dashed track, no fill, no divider, no pins", () => {
    render(<BudgetBar row={row({ spent: 4000 })} />);
    const track = screen.getByRole("img", { name: /No target/ });
    // No divider or historical pins exist.
    expect(within(track).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /target/i })).toBeNull();
    // A dashed placeholder track, not a filled bar (no level to imply).
    expect(track.className).toMatch(/border-dashed/);
    expect(track.querySelector("div")).toBeNull();
  });

  it("explicit-zero target: no divider line and no pins, fill into the red zone", () => {
    render(<BudgetBar row={row({ assigned: 0, spent: 500 })} />);
    const track = screen.getByRole("img");
    // Divider is suppressed at fraction 0; no historical pins.
    expect(screen.queryByRole("button", { name: /target/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Budget:/ })).toBeNull();
    const fill = fillOf(track);
    expect(fill.getAttribute("style")).toMatch(/var\(--amount-expense\)/);
    expect(parseFloat(fill.style.width)).toBeGreaterThan(TARGET_FRACTION * 100);
  });
});
