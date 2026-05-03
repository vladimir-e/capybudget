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

export async function writeFile(_path: string, _content: Uint8Array): Promise<void> {
  // no-op: demo doesn't write binary files
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export async function readDir(_path: string): Promise<DirEntry[]> {
  return [];
}

export async function remove(path: string): Promise<void> {
  store.delete(path);
}

export async function mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
  // no-op: in-memory store has no directories
}

export async function exists(path: string): Promise<boolean> {
  return store.has(path);
}

export interface FileInfo {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export async function stat(path: string): Promise<FileInfo> {
  const content = store.get(path);
  if (content === undefined) throw new Error(`File not found: ${path}`);
  return {
    size: content.length,
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  };
}
