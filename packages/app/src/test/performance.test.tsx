import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { generatePerfData } from "@/test/generate-perf-data";

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

const TIMEOUT = 30_000;

describe("TransactionList performance", () => {
  it("renders 1000 transactions", async () => {
    const seed = generatePerfData(1000);

    const t0 = performance.now();
    await renderApp({ seed });
    await waitForApp();

    const table = await screen.findByRole("table");
    const t1 = performance.now();

    console.log(`[perf] 1000 transactions — render: ${(t1 - t0).toFixed(0)}ms`);
    expect(table).toBeInTheDocument();
  }, TIMEOUT);

  it("renders 5000 transactions", async () => {
    const seed = generatePerfData(5000);

    const t0 = performance.now();
    await renderApp({ seed });
    await waitForApp();

    const table = await screen.findByRole("table");
    const t1 = performance.now();

    console.log(`[perf] 5000 transactions — render: ${(t1 - t0).toFixed(0)}ms`);
    expect(table).toBeInTheDocument();
  }, TIMEOUT);
});
