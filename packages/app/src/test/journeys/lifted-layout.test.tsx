import "@/test/journeys/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type CapySession,
  type SessionOptions,
  type StreamEvent,
} from "@capybudget/intelligence";

// These journeys all exercise the lifted BudgetLayout boundary: the layout is
// persistent and owns the Capy session + budget name, while the _shell and
// settings children swap underneath it. Mounting the full route tree is what
// makes that boundary real — a hook test can't see the settings↔shell swap.

// In-memory file system so the Settings editor's writeTextFile and the shared
// budget-file query's readTextFile round-trip — the same behavior the real
// Tauri fs gives us, without touching disk.
const fsStore = new Map<string, string>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const content = fsStore.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fsStore.set(path, content);
  }),
  rename: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(async (path: string) => fsStore.has(path)),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Capture every session the lifted provider creates, with a kill spy, the
// baked-in system prompt, and a way to drive synthetic stream events into the
// chat. Same shape the use-capy-session unit test uses, but here it exercises
// the real route tree: BudgetLayout (persistent) → _shell / settings (swapped).
interface FakeSession {
  systemPrompt: string;
  killSpy: ReturnType<typeof vi.fn>;
  emit: (event: StreamEvent) => void;
}

const { createdSessions, createSessionMock } = vi.hoisted(() => {
  const list: FakeSession[] = [];
  const mock = vi.fn((opts: SessionOptions): CapySession => {
    const killSpy = vi.fn(async () => {});
    list.push({ systemPrompt: opts.systemPrompt, killSpy, emit: opts.onEvent });
    return {
      isAlive: true,
      send: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      kill: killSpy,
    };
  });
  return { createdSessions: list, createSessionMock: mock };
});

vi.mock("@/services/create-session", () => ({
  createSession: createSessionMock,
}));

import { renderApp } from "@/test/render-app";
import { useAppStore } from "@/stores/app-store";
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _resetStoreForTests,
  _setStoreLoaderForTests,
} from "@/stores/intelligence-store";

const TIMEOUT = 15_000;
const ASSISTANT_REPLY = "Capy remembers this conversation.";
const INSTRUCTIONS = "My Amex is for travel; Whole Foods is groceries.";

beforeEach(() => {
  fsStore.clear();
  createdSessions.length = 0;
  createSessionMock.mockClear();
  _resetStoreForTests();
  _resetIntelligenceStoreForTests();
  _setStoreLoaderForTests(async () => ({ get: async () => null, set: async () => {} }));
  useAppStore.setState({
    recentBudgets: [
      { path: "/test-budget", name: "Test Budget", lastOpened: "2026-01-01T00:00:00.000Z" },
    ],
  });
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
  useAppStore.setState({ recentBudgets: [] });
});

async function openCapy(user: UserEvent) {
  const opener = screen.queryByRole("button", { name: "Open Capy assistant" });
  if (opener) await user.click(opener);
}

async function sendOnce(user: UserEvent, text: string) {
  await openCapy(user);
  const input = await screen.findByPlaceholderText("Ask Capy anything about your finances...");
  await user.type(input, text);
  await user.click(screen.getByRole("button", { name: "Send message" }));
}

/** Open the overlay, send a message, and stream back an assistant reply. */
async function seedConversation(user: UserEvent) {
  await sendOnce(user, "What did I spend?");

  await waitFor(() => expect(createdSessions).toHaveLength(1));
  const session = createdSessions[0];
  session.emit({ type: "content", blocks: [{ type: "text", content: ASSISTANT_REPLY }] });
  session.emit({ type: "done" });

  await waitFor(() => expect(screen.getByText(ASSISTANT_REPLY)).toBeInTheDocument());
  return session;
}

describe("Lifted BudgetLayout boundary", () => {
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

  it("builds a new conversation's session with instructions edited in Settings", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    // First conversation: no instructions on disk yet.
    await sendOnce(user, "What did I spend?");
    await waitFor(() => expect(createdSessions).toHaveLength(1));
    expect(createdSessions[0].systemPrompt).not.toContain(INSTRUCTIONS);

    // Edit instructions from the Settings editor (a different surface than the
    // session-owning layout — the crux of the lifted-boundary bug).
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    // Settings lands on General; the chat-instructions editor lives under Intelligence.
    await user.click(screen.getByRole("button", { name: /Intelligence/i }));
    const editor = await screen.findByPlaceholderText(/I use my Chase card/);
    await user.type(editor, INSTRUCTIONS);
    await user.click(screen.getByRole("button", { name: /Save/ }));

    // Back to the budget and start a fresh conversation.
    await user.click(screen.getByRole("button", { name: "Back to budget" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });
    await openCapy(user);
    await user.click(await screen.findByRole("button", { name: /New chat/i }));

    await sendOnce(user, "What did I spend now?");

    // The next session must carry the freshly-edited instructions — proof the
    // Settings edit propagated across the lifted session boundary.
    await waitFor(() => expect(createdSessions).toHaveLength(2));
    expect(createdSessions[1].systemPrompt).toContain(INSTRUCTIONS);
  }, TIMEOUT);

  it("threads a live rename into the nav links and recents without a reopen", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    const railSettings = () => screen.getByRole("link", { name: "Settings" });
    expect(railSettings().getAttribute("href")).toContain("name=Test+Budget");

    // Rename from the Settings General section — a different surface than the
    // layout that owns the name.
    await user.click(railSettings());
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    const nameInput = screen.getByLabelText("Budget name");
    await user.clear(nameInput);
    await user.type(nameInput, "Travel Fund");
    await user.tab();

    // Back to the budget — the layout (and its Capy session) never unmounted;
    // only the settings↔shell child swapped. The back-nav even re-threads the
    // *stale* URL name, so the rail showing the new one proves it derives from
    // budget.json, not the search param.
    await user.click(screen.getByRole("button", { name: "Back to budget" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(railSettings().getAttribute("href")).toContain("name=Travel+Fund");
    });

    // The home-screen recents entry tracks the rename too.
    expect(useAppStore.getState().recentBudgets[0]?.name).toBe("Travel Fund");
  }, TIMEOUT);
});
