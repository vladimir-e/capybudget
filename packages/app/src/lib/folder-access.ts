// Security-scoped folder access for the MAS sandbox. No-ops in the DMG build,
// where raw path access needs no bookmark. See src-tauri/src/security_scope.rs.

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/app-store";

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

// Prune stored bookmarks down to the folders the UI still tracks (recents +
// launch budget), so the store can't grow past what the user can see. Run at
// boot and after each open.
export async function reconcileFolderAccess(): Promise<void> {
  if (!__MAS__) return;
  const { recentBudgets, launchBudgetPath } = useAppStore.getState();
  const keep = recentBudgets.map((b) => b.path);
  if (launchBudgetPath && !keep.includes(launchBudgetPath)) {
    keep.push(launchBudgetPath);
  }
  try {
    await invoke("reconcile_folder_access", { keep });
  } catch (err) {
    console.error("reconcile_folder_access failed", err);
  }
}
