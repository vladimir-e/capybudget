import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount every React tree rendered via Testing Library (renderApp,
// renderHook, component tests) after each test. Without this, mounted roots
// outlive their test and async state updates (e.g. a session's fire-and-forget
// send) get scheduled against them; when jsdom tears down between files the
// React scheduler flushes that work against a gone `window` — an intermittent
// "window is not defined" unhandled error. Unmounting cancels that work.
afterEach(() => {
  cleanup();
});

// ── Browser API polyfills for jsdom ─────────────────────────

// ResizeObserver (used by Radix/base-ui components)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// IntersectionObserver (used by the Help screen's scroll-spy)
globalThis.IntersectionObserver = class IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

// matchMedia (used by next-themes)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// scrollIntoView (used by some Radix/base-ui components)
Element.prototype.scrollIntoView = vi.fn();

// getAnimations (used by base-ui ScrollArea)
Element.prototype.getAnimations = () => [];

// ── Tauri API mocks ─────────────────────────────────────────

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
  Command: {
    create: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    })),
  },
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

