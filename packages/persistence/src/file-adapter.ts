/**
 * Filesystem abstraction shared by every package that touches disk.
 *
 * The CSV repository only needs the four core ops (read/write/rename/join)
 * to work. The extended ops (mkdir, exists, readDir, appendFile, remove,
 * stat) are needed by the import + CSV tool handlers in
 * `@capybudget/intelligence/tools/handlers/`. Both implementations
 * (node fs in `@capybudget/mcp`, Tauri fs in `@capybudget/app`) cover
 * the full surface; the demo browser stub mirrors it with an in-memory
 * map.
 */

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface FileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
}

export interface FileAdapter {
  // Core (CSV repository)
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  join(...parts: string[]): Promise<string>;

  // Extended (import + CSV tool handlers)
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<DirEntry[]>;
  appendFile(path: string, content: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<FileStat>;
}
