import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { HistoryNav } from "./history-nav";

async function renderHistoryNav(
  props: { initialEntries?: string[]; initialIndex?: number } = {},
) {
  const rootRoute = createRootRoute({
    component: () => <HistoryNav />,
  });

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({
      initialEntries: props.initialEntries ?? ["/"],
      initialIndex: props.initialIndex,
    }),
  });

  await router.load();

  const result = render(<RouterProvider router={router} />);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  return { ...result, router };
}

describe("HistoryNav", () => {
  afterEach(cleanup);

  it("disables both history arrows at the only history entry", async () => {
    await renderHistoryNav();

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("enables back (not forward) when sitting at the latest of several entries", async () => {
    await renderHistoryNav({ initialEntries: ["/", "/", "/"], initialIndex: 2 });

    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("enables forward after stepping back through history", async () => {
    const { router } = await renderHistoryNav({ initialEntries: ["/", "/"], initialIndex: 1 });

    router.history.back();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  // Regression: a branch navigation (step back, then push a new route) truncates
  // the forward stack, so Forward must disable even though it was enabled
  // mid-history. The live history length self-corrects here; a max-seen ceiling
  // would leave Forward stuck enabled over the now-discarded entries.
  it("disables forward after a branch navigation truncates the forward stack", async () => {
    const { router } = await renderHistoryNav({
      initialEntries: ["/", "/", "/", "/"],
      initialIndex: 3,
    });

    router.history.back();
    router.history.back();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    });

    router.history.push("/");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    });
  });
});
