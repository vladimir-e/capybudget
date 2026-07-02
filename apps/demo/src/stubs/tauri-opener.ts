/** Stub for @tauri-apps/plugin-opener — used in browser demo. */

export async function openUrl(url: string | URL): Promise<void> {
  if (typeof window !== "undefined") {
    window.open(String(url), "_blank", "noopener,noreferrer");
  }
}

export async function revealItemInDir(_path: string | string[]): Promise<void> {}
