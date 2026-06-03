import { createContext, useContext } from "react";

/**
 * True while the platform modifier (⌘ on Mac, Ctrl elsewhere) has been held
 * past the reveal delay, with no other key pressed. Drives the keyboard-shortcut
 * hint badges scattered across the budget chrome. Provided by `ModHintProvider`.
 */
export const ModHintContext = createContext(false);

/** Whether shortcut hint badges should currently be revealed. */
export function useModHint(): boolean {
  return useContext(ModHintContext);
}
