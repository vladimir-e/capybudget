import { describe, it, expect, beforeEach } from "vitest";
import { useImportStore } from "@/stores/import-store";

describe("import-store", () => {
  beforeEach(() => {
    useImportStore.setState({ hasImportData: false, phase: "idle" });
  });

  it("starts with hasImportData false", () => {
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  it("setHasImportData updates the flag", () => {
    useImportStore.getState().setHasImportData(true);
    expect(useImportStore.getState().hasImportData).toBe(true);

    useImportStore.getState().setHasImportData(false);
    expect(useImportStore.getState().hasImportData).toBe(false);
  });
});
