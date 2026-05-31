import { createContext, useContext } from "react";
import type { FileAttachment, ChatMessage } from "@capybudget/intelligence";

/**
 * The single Capy session, lifted to the `/budget` layout so it outlives the
 * chrome↔settings swap. The session, its message state, and the panel's open
 * flag are all created once per budget and survive a trip through full-screen
 * settings — the whole chat is one piece of state, not split between the
 * persistent layout and the transient shell. The chrome (BudgetShell) and the
 * overlay are pure consumers.
 */
export interface CapySessionContextValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (text: string, files?: FileAttachment[]) => void;
  stopStreaming: () => void;
  newChat: () => void;
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

export const CapySessionContext = createContext<CapySessionContextValue | null>(null);

export function useCapySessionContext(): CapySessionContextValue {
  const ctx = useContext(CapySessionContext);
  if (!ctx) throw new Error("useCapySessionContext must be used within CapySessionProvider");
  return ctx;
}
