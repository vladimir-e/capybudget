import { useEffect, useState } from "react";

/** Resolve CSS custom properties reactively — re-reads on theme/dark-mode changes. */
export function useThemeColors<T extends Record<string, string>>(
  vars: Record<keyof T, [cssVar: string, fallback: string]>,
): T {
  const [colors, setColors] = useState(() => resolve(vars));

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(resolve(vars)));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []); // vars is stable (object literal at call site gets recreated but keys don't change)

  return colors;
}

function resolve<T extends Record<string, string>>(
  vars: Record<keyof T, [cssVar: string, fallback: string]>,
): T {
  const style = getComputedStyle(document.documentElement);
  const result = {} as Record<string, string>;
  for (const [key, [cssVar, fallback]] of Object.entries(vars)) {
    result[key] = style.getPropertyValue(cssVar).trim() || fallback;
  }
  return result as T;
}
