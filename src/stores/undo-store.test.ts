import { describe, it, expect, beforeEach } from "vitest";
import { useUndoStore, type Snapshot } from "@/stores/undo-store";

function snap(label: string): Snapshot {
  return {
    accounts: [{ id: label, name: label, type: "checking", archived: false, sortOrder: 0, createdAt: "" }],
    categories: [],
    transactions: [],
  };
}

describe("undo-store", () => {
  beforeEach(() => {
    useUndoStore.getState().reset();
  });

  it("starts empty with no undo/redo", () => {
    const state = useUndoStore.getState();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.present).toBeNull();
  });

  it("pushSnapshot sets present and enables undo after second push", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    expect(useUndoStore.getState().canUndo).toBe(false);

    useUndoStore.getState().pushSnapshot(snap("b"));
    expect(useUndoStore.getState().canUndo).toBe(true);
    expect(useUndoStore.getState().present?.accounts[0].id).toBe("b");
  });

  it("undo restores previous snapshot", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    useUndoStore.getState().pushSnapshot(snap("b"));

    const restored = useUndoStore.getState().undo();
    expect(restored?.accounts[0].id).toBe("a");
    expect(useUndoStore.getState().present?.accounts[0].id).toBe("a");
    expect(useUndoStore.getState().canRedo).toBe(true);
  });

  it("redo moves forward", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    useUndoStore.getState().pushSnapshot(snap("b"));
    useUndoStore.getState().undo();

    const restored = useUndoStore.getState().redo();
    expect(restored?.accounts[0].id).toBe("b");
    expect(useUndoStore.getState().canRedo).toBe(false);
  });

  it("new push clears future", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    useUndoStore.getState().pushSnapshot(snap("b"));
    useUndoStore.getState().undo();
    useUndoStore.getState().pushSnapshot(snap("c"));

    expect(useUndoStore.getState().canRedo).toBe(false);
    expect(useUndoStore.getState().present?.accounts[0].id).toBe("c");
  });

  it("undo on empty past returns null", () => {
    const result = useUndoStore.getState().undo();
    expect(result).toBeNull();
  });

  it("redo on empty future returns null", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    const result = useUndoStore.getState().redo();
    expect(result).toBeNull();
  });

  it("caps stack at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      useUndoStore.getState().pushSnapshot(snap(`s${i}`));
    }
    expect(useUndoStore.getState().past.length).toBeLessThanOrEqual(50);
  });

  it("multiple undo/redo cycle works", () => {
    useUndoStore.getState().pushSnapshot(snap("a"));
    useUndoStore.getState().pushSnapshot(snap("b"));
    useUndoStore.getState().pushSnapshot(snap("c"));

    useUndoStore.getState().undo(); // c → b
    useUndoStore.getState().undo(); // b → a
    expect(useUndoStore.getState().present?.accounts[0].id).toBe("a");

    useUndoStore.getState().redo(); // a → b
    useUndoStore.getState().redo(); // b → c
    expect(useUndoStore.getState().present?.accounts[0].id).toBe("c");
    expect(useUndoStore.getState().canRedo).toBe(false);
  });
});
