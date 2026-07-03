// OS keychain transport for provider API keys — one generic-password entry per
// provider, keyed by the app bundle id on the Rust side. See
// src-tauri/src/keychain.rs. The persistence policy lives in
// stores/secret-config.ts; this is just the Tauri bridge.

import { invoke } from "@tauri-apps/api/core";
import type { Keychain, SecretProvider } from "@/stores/secret-config";

const ACCOUNT: Record<SecretProvider, string> = {
  anthropic: "anthropic-api-key",
  openai: "openai-api-key",
};

export const tauriKeychain: Keychain = {
  get(provider) {
    return invoke<string | null>("keychain_get", { account: ACCOUNT[provider] });
  },
  async set(provider, secret) {
    const account = ACCOUNT[provider];
    if (secret) {
      await invoke("keychain_set", { account, secret });
    } else {
      await invoke("keychain_delete", { account });
    }
  },
};

// Dev builds are ad-hoc signed, and macOS rebuilds the signature on every
// `tauri dev` rebuild — so the keychain re-prompts each run. Off by default in
// dev (keys stay in the throwaway config file); set VITE_CAPY_KEYCHAIN=1 to
// exercise the real path. Release builds are stably signed, so it's always on.
export function keychainEnabled(): boolean {
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_CAPY_KEYCHAIN === "1";
  }
  return true;
}
