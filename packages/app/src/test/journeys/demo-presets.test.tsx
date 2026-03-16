import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { PRESET_LIST, type DemoPreset } from "@demo/data/presets";

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

describe.each(PRESET_LIST.map((p) => [p.name, p] as const))(
  "Demo preset: %s",
  (_name: string, preset: DemoPreset) => {
    it("renders all accounts in sidebar", async () => {
      await renderApp({ seed: preset });
      await waitForApp();

      for (const account of preset.accounts) {
        expect(getSidebarAccountLink(account.name)).toBeInTheDocument();
      }
    }, TIMEOUT);

    it("shows transactions in table", async () => {
      await renderApp({ seed: preset });
      await waitForApp();

      const table = screen.getByRole("table");
      const rows = within(table).getAllByRole("row");
      // Header row + at least some data rows
      expect(rows.length).toBeGreaterThan(1);
    }, TIMEOUT);

    it("navigates to a single account view", async () => {
      const { user } = await renderApp({ seed: preset });
      await waitForApp();

      const firstAccount = preset.accounts[0];
      await user.click(getSidebarAccountLink(firstAccount.name));

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: firstAccount.name })).toBeInTheDocument();
      });

      // Should still show a table (this account has transactions)
      expect(screen.getByRole("table")).toBeInTheDocument();
    }, TIMEOUT);
  },
);
