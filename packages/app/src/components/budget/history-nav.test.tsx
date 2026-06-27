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

  // The forward ceiling is the furthest index seen, not history.length — so once
  // we step forward back up to that ceiling, Forward disables again.
  it("disables forward again after returning to the furthest entry", async () => {
    const { router } = await renderHistoryNav({ initialEntries: ["/", "/"], initialIndex: 1 });

    router.history.back();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    });

    router.history.forward();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    });
  });

  // Mount below the top entry: the forward arrow stays disabled until we've
  // actually advanced (max-seen ceiling grows), then re-enables on stepping back.
  it("grows the forward ceiling as history advances", async () => {
    const { router } = await renderHistoryNav({ initialEntries: ["/", "/"], initialIndex: 0 });

    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    router.history.forward();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    router.history.back();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    });
  });
});
