/** Stub for @tauri-apps/plugin-fs — in-memory file system for browser demo. */

const store = new Map<string, string>();

export async function readTextFile(path: string): Promise<string> {
  const content = store.get(path);
  if (content === undefined) throw new Error(`File not found: ${path}`);
  return content;
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  store.set(path, content);
}

