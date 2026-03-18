import { describe, it, expect, beforeEach } from "vitest";
import { useImportStore } from "@/stores/import-store";

describe("import-store", () => {
  beforeEach(() => {
    useImportStore.getState().reset();
  });

  it("starts idle with no source files", () => {
    const state = useImportStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.sourceFiles).toEqual([]);
  });

  it("setPhase updates the phase", () => {
    useImportStore.getState().setPhase("upload");
    expect(useImportStore.getState().phase).toBe("upload");

    useImportStore.getState().setPhase("preview");
    expect(useImportStore.getState().phase).toBe("preview");
  });

  it("setSourceFiles updates the source files", () => {
    const files = [
      { name: "checking.csv", size: 1024 },
      { name: "savings.csv", size: 2048 },
    ];
    useImportStore.getState().setSourceFiles(files);
    expect(useImportStore.getState().sourceFiles).toEqual(files);
  });

  it("reset returns to idle with empty source files", () => {
    useImportStore.getState().setPhase("review");
    useImportStore.getState().setSourceFiles([{ name: "data.csv", size: 512 }]);

    useImportStore.getState().reset();
    expect(useImportStore.getState().phase).toBe("idle");
    expect(useImportStore.getState().sourceFiles).toEqual([]);
  });
});
