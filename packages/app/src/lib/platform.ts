export const isMac = navigator.userAgent.includes("Mac");

/** Platform-appropriate prefix for a keyboard shortcut, e.g. `⌘` on Mac, `Ctrl+` elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl+";
