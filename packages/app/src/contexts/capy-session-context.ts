import { createContext, useContext } from "react";
import type { FileAttachment, ChatMessage } from "@capybudget/intelligence";

// The single Capy session (messages + open flag), provided by the `/budget`
// layout so it outlives the chrome↔settings swap. Consumers are read-only.
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
