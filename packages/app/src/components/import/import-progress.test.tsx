import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImportPhase } from "@capybudget/intelligence";
import { ImportProgress } from "./import-progress";

/** Render ImportProgress at the given phase with inert defaults. */
function renderProgress(
  props: Partial<Parameters<typeof ImportProgress>[0]> & { phase: ImportPhase },
) {
  return render(
    <ImportProgress
      running={false}
      status=""
      log={[]}
      normalizeProgress={null}
      batchProgress={null}
      onStop={vi.fn()}
      enrich={null}
      {...props}
    />,
  );
}

describe("ImportProgress — run control", () => {
  it("shows Stop while a run is in flight and wires it to onStop", async () => {
    const onStop = vi.fn();
    renderProgress({ phase: "normalizing", running: true, onStop });

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
  });

  it("shows Enrich N when idle with enrichable rows and wires it to run", async () => {
    const run = vi.fn();
    renderProgress({ phase: "done", enrich: { count: 7, run } });

    await userEvent.click(screen.getByRole("button", { name: "Enrich 7" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("hides the control entirely when idle with nothing left to enrich", () => {
    renderProgress({ phase: "done", enrich: { count: 0, run: vi.fn() } });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ImportProgress — Normalizing meter", () => {
  const normalizeProgress = { rows: 12, total: 30 };

  it("attaches the meter count while the Normalizing segment is active", () => {
    renderProgress({ phase: "normalizing", running: true, normalizeProgress });
    expect(screen.getByText("12 of 30")).toBeInTheDocument();
  });

  it("detaches the meter once the pipeline moves past Normalizing", () => {
    // Its totals were estimates — the done segment is simply done, no count.
    renderProgress({ phase: "categorizing", running: true, normalizeProgress });
    expect(screen.queryByText("12 of 30")).toBeNull();
  });
});
