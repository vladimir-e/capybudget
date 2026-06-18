import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Errors propagate to the caller: the panel surfaces them, the boot check
// swallows its own.

export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

export async function installUpdate(
  update: Update,
  onProgress?: (p: { downloaded: number; total: number | null }) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
    }
  });
  await relaunch();
}
