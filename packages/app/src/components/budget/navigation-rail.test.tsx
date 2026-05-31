import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { NavigationRail, type Section } from "./navigation-rail";

async function renderRail(props: {
  activeSection: Section;
  hasImportData?: boolean;
  initialPath?: string;
}) {
  const rootRoute = createRootRoute({
    component: () => (
      <NavigationRail
        budgetPath="/test"
        budgetName="Test"
        activeSection={props.activeSection}
        hasImportData={props.hasImportData}
      />
    ),
  });

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [props.initialPath ?? "/"] }),
  });

  await router.load();

  const result = render(<RouterProvider router={router} />);

  // Wait for the router to finish rendering
  await waitFor(() => {
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });

  return result;
}

describe("NavigationRail", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the active section with aria-current", async () => {
    await renderRail({ activeSection: "budget" });

    const budgetLinks = screen.getAllByRole("link", { name: "Budget" });
    const accountsLinks = screen.getAllByRole("link", { name: "Accounts" });

    expect(budgetLinks.some((el) => el.getAttribute("aria-current") === "page")).toBe(true);
    expect(accountsLinks.every((el) => el.getAttribute("aria-current") !== "page")).toBe(true);
  });

  it("shows import indicator when hasImportData is true", async () => {
    const { container, unmount } = await renderRail({ activeSection: "accounts", hasImportData: true });
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    unmount();

    const { container: c2 } = await renderRail({ activeSection: "accounts", hasImportData: false });
    expect(c2.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  it("renders all three sections as links", async () => {
    await renderRail({ activeSection: "accounts" });

    expect(screen.getAllByRole("link", { name: "Accounts" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "Budget" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "Import" }).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the settings gear at the bottom of the rail", async () => {
    await renderRail({ activeSection: "accounts" });

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toBeInTheDocument();
    // Settings lives under /budget and carries the budget's path/name search.
    expect(settingsLink.getAttribute("href")).toMatch(/^\/budget\/settings\?/);
  });

  it("marks settings as active when on /budget/settings", async () => {
    await renderRail({ activeSection: "accounts", initialPath: "/budget/settings" });

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark settings as active when on a budget route", async () => {
    await renderRail({ activeSection: "accounts", initialPath: "/budget" });

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink.getAttribute("aria-current")).not.toBe("page");
  });
});
