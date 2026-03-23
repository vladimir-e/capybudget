import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { NavigationRail, type Section } from "./navigation-rail";

async function renderRail(props: {
  activeSection: Section;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  hasImportData?: boolean;
}) {
  const rootRoute = createRootRoute({
    component: () => (
      <NavigationRail
        budgetPath="/test"
        budgetName="Test"
        activeSection={props.activeSection}
        sidebarOpen={props.sidebarOpen ?? false}
        onToggleSidebar={props.onToggleSidebar ?? (() => {})}
        hasImportData={props.hasImportData}
      />
    ),
  });

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
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
  it("marks the active section with aria-current", async () => {
    await renderRail({ activeSection: "budget" });

    const budgetLinks = screen.getAllByRole("link", { name: "Budget" });
    const accountsLinks = screen.getAllByRole("link", { name: "Accounts" });

    expect(budgetLinks.some((el) => el.getAttribute("aria-current") === "page")).toBe(true);
    expect(accountsLinks.every((el) => el.getAttribute("aria-current") !== "page")).toBe(true);
  });

  it("shows sidebar toggle only on accounts section", async () => {
    const { unmount } = await renderRail({ activeSection: "accounts", sidebarOpen: true });
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
    unmount();

    await renderRail({ activeSection: "budget" });
    expect(screen.queryByLabelText("Collapse sidebar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expand sidebar")).not.toBeInTheDocument();
  });

  it("sidebar toggle label reflects open/closed state", async () => {
    const { unmount } = await renderRail({ activeSection: "accounts", sidebarOpen: true });
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
    unmount();

    await renderRail({ activeSection: "accounts", sidebarOpen: false });
    expect(screen.getByLabelText("Expand sidebar")).toBeInTheDocument();
  });

  it("calls onToggleSidebar when toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    await renderRail({ activeSection: "accounts", sidebarOpen: true, onToggleSidebar: onToggle });

    await user.click(screen.getByLabelText("Collapse sidebar"));
    expect(onToggle).toHaveBeenCalledOnce();
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
});
