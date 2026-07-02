// Security-scoped folder access for the MAS sandbox. No-ops in the DMG build,
// where raw path access needs no bookmark. See src-tauri/src/security_scope.rs.

import { invoke } from "@tauri-apps/api/core";

declare const __MAS__: boolean;

export async function persistFolderAccess(path: string): Promise<void> {
  if (!__MAS__) return;
  try {
    await invoke("persist_folder_access", { path });
  } catch (err) {
    console.error("persist_folder_access failed", err);
  }
}

export async function forgetFolderAccess(path: string): Promise<void> {
  if (!__MAS__) return;
  try {
    await invoke("forget_folder_access", { path });
  } catch (err) {
    console.error("forget_folder_access failed", err);
  }
}
