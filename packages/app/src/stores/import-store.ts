import { create } from "zustand";

/**
 * Minimal store — just the signals the sidebar needs.
 * The import screen derives its view from disk state + session state,
 * not from a phase machine.
 */
interface ImportStore {
  /** True when .capy/import/transactions.csv exists with content. */
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;
}

export const useImportStore = create<ImportStore>((set) => ({
  hasImportData: false,
  setHasImportData: (hasImportData) => set({ hasImportData }),
}));
