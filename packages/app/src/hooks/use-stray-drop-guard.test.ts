import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStrayDropGuard } from "./use-stray-drop-guard";

/**
 * jsdom has no real DataTransfer, so fake the only field the guard reads
 * (`types`) on a plain Event and spy on preventDefault.
 */
function fileDragEvent(type: "dragover" | "drop", types: string[]) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  const preventDefault = vi.spyOn(event, "preventDefault");
  return { event, preventDefault };
}

describe("useStrayDropGuard", () => {
  it("preventDefaults a file dragover/drop (types include 'Files')", () => {
    renderHook(() => useStrayDropGuard());

    for (const type of ["dragover", "drop"] as const) {
      const { event, preventDefault } = fileDragEvent(type, ["Files"]);
      window.dispatchEvent(event);
      expect(preventDefault).toHaveBeenCalledOnce();
    }
  });

  it("ignores a non-file drag (the dnd-kit reorder case)", () => {
    renderHook(() => useStrayDropGuard());

    for (const type of ["dragover", "drop"] as const) {
      const { event, preventDefault } = fileDragEvent(type, ["text/plain"]);
      window.dispatchEvent(event);
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });

  it("removes its listeners on unmount", () => {
    const { unmount } = renderHook(() => useStrayDropGuard());
    unmount();

    const { event, preventDefault } = fileDragEvent("drop", ["Files"]);
    window.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
