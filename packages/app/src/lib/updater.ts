import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

// Single-flight guard: a stray double-call (HMR, double mount in
// StrictMode dev) shouldn't kick off two parallel downloads.
let inFlight: Promise<void> | null = null;

export function checkForUpdates(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  let update: Update | null;
  try {
    update = await check();
  } catch (err) {
    // Network down, GitHub rate-limited, malformed manifest — none of
    // those should bother the user. Silent failure is correct here;
    // they'll be offered the update on the next launch.
    console.warn("update check failed:", err);
    return;
  }
  if (!update) return;

  const confirmed = await ask(
    `Capy Budget ${update.version} is available. Install and restart now?`,
    { title: "Update available", kind: "info", okLabel: "Install", cancelLabel: "Later" },
  );
  if (!confirmed) return;

  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    console.error("update install failed:", err);
  }
}
