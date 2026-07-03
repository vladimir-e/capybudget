/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only "1" forces API keys into the OS keychain (off by default in dev). */
  readonly VITE_CAPY_KEYCHAIN?: string
}
