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

// In-memory file system so the Settings editor's writeTextFile and the
// shared budget-file query's readTextFile round-trip — the same behavior the
// real Tauri fs gives us, without touching disk.
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

// Capture the system prompt baked into every session the lifted provider
// creates. The instruction-propagation guarantee lives in that prompt: a
// fresh conversation must be built with the latest capy-instructions.md.
const { capturedSessions, createSessionMock } = vi.hoisted(() => {
  const list: { systemPrompt: string; emit: (event: StreamEvent) => void }[] = [];
  const mock = vi.fn((opts: SessionOptions): CapySession => {
    list.push({ systemPrompt: opts.systemPrompt, emit: opts.onEvent });
    return {
      isAlive: true,
      send: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
    };
  });
  return { capturedSessions: list, createSessionMock: mock };
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
const INSTRUCTIONS = "My Amex is for travel; Whole Foods is groceries.";

beforeEach(() => {
  fsStore.clear();
  capturedSessions.length = 0;
  createSessionMock.mockClear();
  _resetStoreForTests();
  _resetIntelligenceStoreForTests();
  _setStoreLoaderForTests(async () => ({ get: async () => null, set: async () => {} }));
  useIntelligenceStore.setState({
    hydrated: true,
    config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
  });
});

afterEach(() => {
  _resetIntelligenceStoreForTests();
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

describe("Custom instruction edits reach the next conversation", () => {
  it("builds a new conversation's session with instructions edited in Settings", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    // First conversation: no instructions on disk yet.
    await sendOnce(user, "What did I spend?");
    await waitFor(() => expect(capturedSessions).toHaveLength(1));
    expect(capturedSessions[0].systemPrompt).not.toContain(INSTRUCTIONS);

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
    await waitFor(() => expect(capturedSessions).toHaveLength(2));
    expect(capturedSessions[1].systemPrompt).toContain(INSTRUCTIONS);
  }, TIMEOUT);
});
