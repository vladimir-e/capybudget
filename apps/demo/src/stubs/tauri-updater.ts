/** Stub for @tauri-apps/plugin-updater — used in browser demo. */

export type Update = {
  version: string;
  downloadAndInstall(): Promise<void>;
};

export async function check(): Promise<Update | null> {
  return null;
}
