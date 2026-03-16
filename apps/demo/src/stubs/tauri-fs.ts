/** Stub for @tauri-apps/plugin-fs — used in browser demo. */

export async function readTextFile(_path: string): Promise<string> {
  throw new Error("File system not available in demo");
}

export async function writeTextFile(_path: string, _content: string): Promise<void> {
  // no-op
}
