import { useCallback, useState } from "react";

/** Persisted one-way "dismissed" flag for a piece of UI (an explainer, a
 *  callout). Reads the initial value from `localStorage` once on mount and
 *  writes through on dismiss, so the dismissal survives reloads. Storage that
 *  is unavailable or malformed degrades to "not dismissed" rather than
 *  throwing — the worst case is the callout showing again, never a crash.
 *
 *  Keys are namespaced under `capybudget:dismissed:` so they don't collide
 *  with other localStorage usage. */
export function dismissedStorageKey(key: string): string {
  return `capybudget:dismissed:${key}`;
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(dismissedStorageKey(key)) === "1";
  } catch {
    return false;
  }
}

export function useDismissed(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => readDismissed(key));

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedStorageKey(key), "1");
    } catch {
      /* storage unavailable — the in-memory flag still hides it this session */
    }
  }, [key]);

  return [dismissed, dismiss];
}
