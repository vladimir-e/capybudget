import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { dismissedStorageKey, useDismissed } from "./use-dismissed";

describe("useDismissed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("starts not-dismissed when storage is empty", () => {
    const { result } = renderHook(() => useDismissed("explainer"));
    expect(result.current[0]).toBe(false);
  });

  it("reads an existing dismissal from storage on mount", () => {
    localStorage.setItem(dismissedStorageKey("explainer"), "1");
    const { result } = renderHook(() => useDismissed("explainer"));
    expect(result.current[0]).toBe(true);
  });

  it("dismiss() flips the flag and persists it under the namespaced key", () => {
    const { result } = renderHook(() => useDismissed("explainer"));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("capybudget:dismissed:explainer")).toBe("1");
  });

  it("persisted dismissal survives a remount", () => {
    const first = renderHook(() => useDismissed("explainer"));
    act(() => first.result.current[1]());
    first.unmount();

    const second = renderHook(() => useDismissed("explainer"));
    expect(second.result.current[0]).toBe(true);
  });

  it("scopes flags by key", () => {
    const a = renderHook(() => useDismissed("a"));
    act(() => a.result.current[1]());
    const b = renderHook(() => useDismissed("b"));
    expect(b.result.current[0]).toBe(false);
  });

  it("degrades to not-dismissed when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useDismissed("explainer"));
    expect(result.current[0]).toBe(false);
  });

  it("does not throw when storage writes throw, still hides for the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useDismissed("explainer"));
    expect(() => act(() => result.current[1]())).not.toThrow();
    expect(result.current[0]).toBe(true);
  });
});
