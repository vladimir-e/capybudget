import { useEffect, useRef, useState } from "react";
import { isMac } from "@/lib/platform";
import { ModHintContext } from "@/contexts/mod-hint-context";

/** Delay before revealing — long enough that a quick ⌘N / ⌘C never flashes the map. */
const REVEAL_DELAY_MS = 250;

function isModKey(e: KeyboardEvent): boolean {
  return isMac ? e.key === "Meta" : e.key === "Control";
}

export function ModHintProvider({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = () => {
      clearTimer();
      setRevealed(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isModKey(e)) {
        if (timerRef.current === null && !revealed) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setRevealed(true);
          }, REVEAL_DELAY_MS);
        }
      } else {
        // Any other key while waiting means this is a chord (⌘N etc.), not a hold.
        hide();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isModKey(e)) hide();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", hide);
      clearTimer();
    };
  }, [revealed]);

  return <ModHintContext.Provider value={revealed}>{children}</ModHintContext.Provider>;
}
