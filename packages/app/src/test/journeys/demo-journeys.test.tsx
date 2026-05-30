import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { JOURNEY_FIXTURE } from "@demo/data/journey-fixture";

// CI runners are ~2-3x slower than local; give journey tests breathing room.
const TIMEOUT = 15_000;

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

/** Find an account link in the sidebar (disambiguates from selectors/form elements). */
function getSidebarAccountLink(name: string): HTMLElement {
  const matches = screen.getAllByText(name);
  const inLink = matches.find((el) => el.closest("a"));
  if (!inLink) throw new Error(`Account "${name}" not found in sidebar`);
  return inLink;
}

// These exercise the app shell against a tiny static fixture, decoupled from the
// demo data generator. Generator correctness is covered by generator.test.ts.
describe("Demo budget journeys", () => {
  it("renders all accounts in sidebar", async () => {
    await renderApp({ seed: JOURNEY_FIXTURE });
    await waitForApp();

    for (const account of JOURNEY_FIXTURE.accounts) {
      expect(getSidebarAccountLink(account.name)).toBeInTheDocument();
    }
  }, TIMEOUT);

  it("shows transactions in table", async () => {
    await renderApp({ seed: JOURNEY_FIXTURE });
    await waitForApp();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // Header row + at least some data rows
    expect(rows.length).toBeGreaterThan(1);
  }, TIMEOUT);

  it("navigates to a single account view", async () => {
    const { user } = await renderApp({ seed: JOURNEY_FIXTURE });
    await waitForApp();

    const firstAccount = JOURNEY_FIXTURE.accounts[0];
    await user.click(getSidebarAccountLink(firstAccount.name));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: firstAccount.name })).toBeInTheDocument();
    });

    // Should still show a table (this account has transactions)
    expect(screen.getByRole("table")).toBeInTheDocument();
  }, TIMEOUT);
});
