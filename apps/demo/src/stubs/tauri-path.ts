/** Stub for @tauri-apps/api/path — used in browser demo. */

export async function join(...parts: string[]): Promise<string> {
  return parts.join("/");
}

export async function tempDir(): Promise<string> {
  return "/tmp";
}
