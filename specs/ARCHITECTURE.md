# Architecture

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Monorepo | npm workspaces | Package management, dependency hoisting |
| Desktop shell | Tauri v2 | Lightweight native wrapper (~15 lines Rust) |
| Frontend | React 19 + TypeScript | UI components and application logic |
| Bundler | Vite 7 | Dev server and production builds |
| Routing | TanStack Router | Type-safe file-based routing |
| Data cache | TanStack Query 5 | Async cache with fetch, invalidate, loading states |
| App state | Zustand 5 | Lightweight stores (app state) |
| UI primitives | shadcn/ui (Radix) | Accessible components, owned by the project |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| CSV | PapaParse | Parse/unparse CSV with type coercion |

### Tauri Plugins (Desktop Shell)

| Need | Plugin |
|---|---|
| File read/write | `@tauri-apps/plugin-fs` |
| Folder picker | `@tauri-apps/plugin-dialog` |
| Open URLs + reveal in file manager | `@tauri-apps/plugin-opener` (external links, Reveal in Finder) |
| Subprocess spawning | `@tauri-apps/plugin-shell` (Claude CLI adapter only; excluded from the sandboxed MAS build) |
| App config persistence | `@tauri-apps/plugin-store` (intelligence provider config; API keys live in the OS keychain) |

## Principles

### All Logic in TypeScript

Rust is only used for Tauri plugin registration. All application logic — data parsing, validation, queries, UI — lives in TypeScript.

### Functional Style

- Pure functions for data transformations
- Immutable data structures
- Side effects isolated to adapter boundaries
- Composable utilities over class hierarchies

### Single Responsibility

- A **service** (core) contains pure data transformations — no I/O
- A **repository** (persistence) handles storage — doesn't know about UI
- A **hook** (app) bridges data to React — no business logic
- A **component** (app) displays data — no file I/O
- The **intelligence layer** produces structured data — the app validates and writes

### Monorepo

See `MONOREPO.md` for package layout, dependency graph, and adapter pattern.

## Data Flow

```
User picks folder (or demo loads preset data)
  → BudgetService adapter detects/bootstraps budget
  → CsvRepository reads CSVs via FileAdapter
  → PapaParse with typed coercion → domain objects
  → TanStack Query cache
  → UI reads via query hooks
  → mutations apply pure service functions from @capybudget/core
  → optimistic cache update → repo.save*()
```

## Mutation Strategy

### Optimistic Updates

1. Validate locally. If invalid, show inline error immediately.
2. Apply pure service function from `@capybudget/core`.
3. Update TanStack Query cache immediately.
4. Persist via repository in the background (debounced).
5. On write failure: show blocking error. No retry, no partial rollback.

### Write Safety

- Atomic writes (temp file → rename)
- Debounced flush (rapid mutations batched)

## Routing

TanStack Router with file-based routing. Routes live in `packages/app/src/routes/`.

- `/` — Budget selector
- `/budget?path=...&name=...` — Budget workspace

## State Management

| Concern | Solution | Persistence |
|---|---|---|
| Budget data | TanStack Query | Repository adapter |
| Recent budgets | Zustand | localStorage |
| UI state | BudgetUIContext | None (ephemeral) |
| Intelligence config | Zustand (intelligence-store) | `plugin-store` JSON (API keys stripped) |
| Provider API keys | OS keychain | One entry per provider |
| Sandboxed folder grants (MAS) | Security-scoped bookmarks | `folder-bookmarks.json` |

## Secrets & Sandboxed Access

### Provider API Keys

Keys live in the OS keychain (macOS Keychain / Windows Credential Manager /
Linux secret-service) — one generic-password entry per provider (`anthropic`,
`openai`), namespaced by the bundle identifier. Ollama has no entry: a local
server authenticates nothing, so there is no key to protect. The rest of the
intelligence config persists to the `plugin-store` JSON with the key slots
blanked.
`createSecretAwareBackend` (`stores/secret-config.ts`) wraps the plaintext store:
on load it reads keys from the keychain and, if it finds inline keys from an
older build, migrates them into the keychain and rewrites the file without them;
on save it writes keys to the keychain first, so an interrupted write never
strands a key on disk. With no keychain available (dev builds, unsupported
platform) it degrades to the plaintext on-disk config. The Rust side
(`keychain.rs`) is a thin transport — three commands, present in every build.

On macOS the entries live in the **data-protection keychain**
(`kSecUseDataProtectionKeychain`), where access is granted by the
`keychain-access-groups` entitlement instead of a per-binary ACL. That removes
the "wants to use your confidential information" dialog and keeps the grant
across app updates — the legacy file-based keychain instead binds the ACL to the
exact code signature, which every update and dev rebuild invalidates. Builds not
entitled for it (unsigned dev builds, or a Developer-ID/DMG build with no
embedded provisioning profile) get `errSecMissingEntitlement` from the protected
call and transparently fall back to the legacy file-based keychain; the decision
is cached per process. The first protected read of an account also migrates any
key still in the legacy keychain into the protected store (write-then-delete, so
an interrupted or denied migration just retries), and a delete clears the legacy
copy too so it can't be resurrected. The MAS build carries the entitlement (Team
ID-scoped) and gets the protected store; the DMG build embeds no provisioning
profile, so it stays on the fallback path until one is added.

### Sandboxed Folder Access (Mac App Store build)

The App Sandbox confines the app to user-selected paths, and that grant dies with
the process. To reopen a budget after relaunch without a fresh dialog, the app
stores an app-scoped security-scoped bookmark per granted folder in
`folder-bookmarks.json` (in the app config dir) — a second persistence location
alongside the `plugin-store` config. On startup `restore_folder_access` (run in
Tauri setup) resolves each bookmark, re-granting OS sandbox access, and re-adds
the resolved path to the fs plugin's runtime scope (which the narrow MAS
capability leaves empty). `persist_folder_access` records a bookmark when a
folder is picked; `reconcile_folder_access` prunes bookmarks for folders no
longer in recents (at boot and after each open); `forget_folder_access` drops one
when a recent is removed. Folders that fail to resolve (moved, deleted,
unmounted) stay in the store and fall back to the selector's re-open prompt. The
DMG build needs none of this — raw path access has no sandbox — so the whole
subsystem is gated on the Rust `mas` feature and `__MAS__` on the JS side
(`lib/folder-access.ts`), and its bookmark work is hand-rolled via `objc2`
(`security_scope.rs`) since neither Tauri core nor the fs plugin implement macOS
security-scoped bookmarks.

## Intelligence

See `INTELLIGENCE.md` for the full intelligence layer architecture.

## Testing

See `TESTING.md` for testing strategy and infrastructure.

## Conventions

### File Naming

kebab-case for all files (e.g. `budget-shell.tsx`, `csv-repository.ts`).

### Imports

- `@capybudget/*` for shared packages
- `@/` alias for app-internal imports within `packages/app`

### Components

- Functional components only
- shadcn primitives in `components/ui/`, customized freely

See `STRUCTURE.md` for component decomposition, file placement, and package
internal layout.

## Target Platforms

- **Desktop** — macOS first (native .dmg via Tauri). Windows and Linux via Tauri cross-compilation.
- **Web demo** — browser-based demo with preset data at [demo.capybudget.app](https://demo.capybudget.app). Full UI, no persistence, stub intelligence layer.
- **Promo website** — static marketing site at [capybudget.app](https://capybudget.app). Landing page, privacy policy, documentation. Astro 6, deployed to Vercel.

## Distribution

Open source, MIT license. Public GitHub repo with architecture docs, web demo, promo website, and a standalone MCP server (`@capybudget/mcp`) that works with any MCP-compatible AI agent.
