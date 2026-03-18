import { create } from "zustand";
import type { ImportPhase, ImportSourceFile } from "@capybudget/core";

interface ImportStore {
  phase: ImportPhase | "idle";
  sourceFiles: ImportSourceFile[];

  setPhase: (phase: ImportPhase | "idle") => void;
  setSourceFiles: (files: ImportSourceFile[]) => void;
  reset: () => void;
}

export const useImportStore = create<ImportStore>((set) => ({
  phase: "idle",
  sourceFiles: [],

  setPhase: (phase) => set({ phase }),
  setSourceFiles: (sourceFiles) => set({ sourceFiles }),
  reset: () => set({ phase: "idle", sourceFiles: [] }),
}));
