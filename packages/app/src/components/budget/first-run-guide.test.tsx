import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeAccount, makeTransaction } from "@/test/factories";

// CI runners are ~2-3x slower than local; give journey tests breathing room.
const TIMEOUT = 15_000;

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

function guideList() {
  return screen.getByRole("list", { name: "Setup steps" });
}

describe("First-run guide", () => {
  it("shows the three-step guide on a brand-new budget", async () => {
    await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitForApp();

    expect(screen.getByText("Let’s set up your budget")).toBeInTheDocument();
    const steps = within(guideList()).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(within(steps[0]).getByText("Add your accounts")).toBeInTheDocument();
    expect(within(steps[1]).getByText("Log transactions")).toBeInTheDocument();
    expect(within(steps[2]).getByRole("button", { name: "Ask Capy" })).toBeInTheDocument();
  }, TIMEOUT);

  it("disables step 2 until an account exists, then activates it and marks step 1 done", async () => {
    const { user, repo } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitForApp();

    // No accounts: step 1 not done, step 2 disabled with a tooltip hint.
    let steps = within(guideList()).getAllByRole("listitem");
    expect(within(steps[0]).queryByText("Done")).not.toBeInTheDocument();
    const logBtn = within(steps[1]).getByRole("button", { name: "Add transaction" });
    expect(logBtn).toHaveAttribute("aria-disabled", "true");

    // The hint is the whole point of the aria-disabled (not native-disabled)
    // pattern: a native-disabled button wouldn't fire the hover tooltip.
    await user.hover(logBtn);
    expect(await screen.findByText("Add an account first.")).toBeInTheDocument();

    // Add an account via the guide's own step-1 button.
    await user.click(within(steps[0]).getByRole("button", { name: "Add account" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "My Checking");
    await user.click(within(dialog).getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Step 1 now reads done; step 2 activates (still on the empty budget).
    await waitFor(() => {
      steps = within(guideList()).getAllByRole("listitem");
      expect(within(steps[0]).getByText("Done")).toBeInTheDocument();
    });
    expect(repo.data.accounts).toHaveLength(1);
    const logBtnNow = within(steps[1]).getByRole("button", { name: "Add transaction" });
    expect(logBtnNow).not.toHaveAttribute("aria-disabled", "true");
  }, TIMEOUT);

  it("opens the Capy overlay from step 3", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitForApp();

    const overlay = screen.getByRole("complementary", { name: "Capy assistant" });
    expect(overlay).toHaveAttribute("inert");

    const steps = within(guideList()).getAllByRole("listitem");
    await user.click(within(steps[2]).getByRole("button", { name: "Ask Capy" }));

    await waitFor(() => expect(overlay).not.toHaveAttribute("inert"));
  }, TIMEOUT);

  it("opens the Help screen from the documentation link", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitForApp();

    await user.click(screen.getByRole("button", { name: "Check the documentation" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Capy Budget — user guide" }),
      ).toBeInTheDocument();
    });
  }, TIMEOUT);

  it("does not show once the budget has any transaction", async () => {
    const account = makeAccount({ id: "acc-1", name: "Checking" });
    const txn = makeTransaction({ id: "txn-1", accountId: "acc-1", merchant: "Corner Store" });
    await renderApp({
      seed: { accounts: [account], categories: [], transactions: [txn] },
    });
    await waitForApp();

    expect(screen.queryByText("Let’s set up your budget")).not.toBeInTheDocument();
  }, TIMEOUT);

  it("shows a plain empty state for an empty account while others hold data", async () => {
    const funded = makeAccount({ id: "acc-funded", name: "Checking" });
    const empty = makeAccount({ id: "acc-empty", name: "New Card" });
    const txn = makeTransaction({ id: "txn-1", accountId: "acc-funded", merchant: "Corner Store" });
    const { user } = await renderApp({
      seed: { accounts: [funded, empty], categories: [], transactions: [txn] },
    });
    await waitForApp();

    const sidebar = screen.getByRole("complementary", { name: "Accounts" });
    await user.click(within(sidebar).getByText("New Card"));

    await waitFor(() => {
      expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    });
    expect(screen.queryByText("Let’s set up your budget")).not.toBeInTheDocument();
  }, TIMEOUT);
});
