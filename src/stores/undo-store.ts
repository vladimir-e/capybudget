import { create } from "zustand";
import type { Account, Category, Transaction } from "@capybudget/core";

export interface Snapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

const MAX_STACK = 50;

interface UndoState {
  past: Snapshot[];
  present: Snapshot | null;
  future: Snapshot[];
  canUndo: boolean;
  canRedo: boolean;
  pushSnapshot(snapshot: Snapshot): void;
  undo(): Snapshot | null;
  redo(): Snapshot | null;
  reset(): void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  present: null,
  future: [],
  canUndo: false,
  canRedo: false,

  pushSnapshot(snapshot: Snapshot) {
    const { present, past } = get();
    const newPast = present
      ? [...past.slice(-(MAX_STACK - 1)), present]
      : past;
    set({
      past: newPast,
      present: snapshot,
      future: [],
      canUndo: newPast.length > 0 || present !== null,
      canRedo: false,
    });
  },

  undo() {
    const { past, present, future } = get();
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);
    const newFuture = present ? [present, ...future] : future;
    set({
      past: newPast,
      present: previous,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
    });
    return previous;
  },

  redo() {
    const { past, present, future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    const newFuture = future.slice(1);
    const newPast = present ? [...past, present] : past;
    set({
      past: newPast,
      present: next,
      future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
    });
    return next;
  },

  reset() {
    set({ past: [], present: null, future: [], canUndo: false, canRedo: false });
  },
}));
