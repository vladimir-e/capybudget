import "@/test/journeys/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type CapySession,
  type StreamEvent,
} from "@capybudget/intelligence";

// Capture every session the lifted provider creates, with a kill spy and a
// way to drive synthetic stream events into the chat. Same shape the
// use-capy-session unit test uses, but here it exercises the real route tree:
// BudgetLayout (persistent) → _shell / settings (swapped).
interface FakeSession {
  killSpy: ReturnType<typeof vi.fn>;
  emit: (event: StreamEvent) => void;
}

const { createdSessions, createSessionMock } = vi.hoisted(() => {
  const list: FakeSession[] = [];
  const mock = vi.fn(
    (opts: { onEvent: (event: StreamEvent) => void }): CapySession => {
      const killSpy = vi.fn(async () => {});
      list.push({ killSpy, emit: opts.onEvent });
      return {
        isAlive: true,
        send: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        restart: vi.fn(async () => {}),
        kill: killSpy,
      };
    },
  );
  return { createdSessions: list, createSessionMock: mock };
});

vi.mock("@/services/create-session", () => ({
  createSession: createSessionMock,
}));

import { renderApp } from "@/test/render-app";
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _resetStoreForTests,
  _setStoreLoaderForTests,
} from "@/stores/intelligence-store";

const TIMEOUT = 15_000;
const ASSISTANT_REPLY = "Capy remembers this conversation.";

beforeEach(() => {
  createdSessions.length = 0;
  createSessionMock.mockClear();
  _resetStoreForTests();
  _resetIntelligenceStoreForTests();
  _setStoreLoaderForTests(async () => ({ get: async () => null, set: async () => {} }));
  // claude-cli with no key: the overlay treats this as configured, so the
  // chat input renders and we can drive a real send. Set synchronously so the
  // overlay sees it on first render (the async loader hydrates too late here).
  useIntelligenceStore.setState({
    hydrated: true,
    config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
  });
});

afterEach(() => {
  _resetIntelligenceStoreForTests();
});

/** Open the overlay, send a message, and stream back an assistant reply. */
async function seedConversation(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Open Capy assistant" }));
  const input = await screen.findByPlaceholderText("Ask Capy anything about your finances...");
  await user.type(input, "What did I spend?");
  await user.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() => expect(createdSessions).toHaveLength(1));
  const session = createdSessions[0];
  session.emit({ type: "content", blocks: [{ type: "text", content: ASSISTANT_REPLY }] });
  session.emit({ type: "done" });

  await waitFor(() => expect(screen.getByText(ASSISTANT_REPLY)).toBeInTheDocument());
  return session;
}

describe("Capy session survives a settings round-trip", () => {
  it("keeps the conversation and the same session across tab → settings → tab", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    const session = await seedConversation(user);

    // Into settings: the chrome (and overlay DOM) unmounts.
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    expect(screen.queryByText(ASSISTANT_REPLY)).not.toBeInTheDocument();

    // Back to the budget.
    await user.click(screen.getByRole("button", { name: "Back to budget" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    // The conversation is intact, the overlay reopened (open state survived),
    // and the session was never torn down or rebuilt.
    await waitFor(() => expect(screen.getByText(ASSISTANT_REPLY)).toBeInTheDocument());
    expect(session.killSpy).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  }, TIMEOUT);

  it("tears the session down when the budget is closed", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    const session = await seedConversation(user);
    expect(session.killSpy).not.toHaveBeenCalled();

    // Close Budget unmounts BudgetLayout → the lifecycle cleanup kills it.
    await user.click(screen.getByRole("button", { name: /test-budget/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Close Budget/i }));

    await waitFor(() => expect(session.killSpy).toHaveBeenCalled());
  }, TIMEOUT);

  it("rebuilds the session when the provider changes", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    const session = await seedConversation(user);

    // Switching provider must rebuild the session (signature change), even
    // though BudgetLayout stays mounted.
    act(() => {
      useIntelligenceStore.getState().setProvider("anthropic");
    });

    await waitFor(() => expect(session.killSpy).toHaveBeenCalled());
  }, TIMEOUT);
});
