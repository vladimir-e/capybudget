# Capy Budget - IDE for personal finance

A local-first desktop app for tracking personal finance.

Built with Tauri v2, React, TypeScript, and optional intelligence layer. Structured as an npm workspaces monorepo with shared packages for the desktop app, MCP server, web demo, and promo website.

**[capybudget.app](https://capybudget.app)** | **[Demo](https://demo.capybudget.app)**

<img src="./apps/www/public/capy-resistance.jpg" alt="Capy Budget" width="350" />

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Run Locally

```bash
npm install
npm start
```

This starts the Vite dev server and opens the Tauri desktop window.

### Demo & Website

```bash
npm run demo              # Web demo dev server (:3000)
npm run www               # Promo website dev server (:3001)
```

### Lint & Test

```bash
npm run lint          # ESLint
npm test              # Vitest (single run)
npm run test:watch    # Vitest in watch mode
```

### Build

```bash
npm run tauri build
```

Produces a native `.dmg` (macOS), `.exe` (Windows), or `.deb`/`.AppImage` (Linux).

### Releasing

Releases are cut from `main` via a tag. The `release.yml` workflow builds
and signs installers for macOS, Windows, and Linux, attaches them to a
**draft** GitHub Release along with a Tauri updater manifest (`latest.json`).
Promotion is manual — test the draft's artifacts, then publish it from the
GitHub UI (or `gh release edit vX.Y.Z --draft=false --latest`). The auto-
updater only sees the new version once the release is promoted, since
`/releases/latest` skips drafts.

```bash
npm run release 0.2.0      # bumps versions, commits, tags v0.2.0
git push --follow-tags     # triggers the Release workflow (draft only)
```

The stable download URLs (used by the website and the auto-updater) always
resolve to the newest published release:

- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-macos.dmg`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-windows-x64.exe`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-linux-x64.AppImage`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-linux-x64.deb`

**Required repo secrets:**

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key (`tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater key |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | App-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

### Mac App Store build

A separate, sandboxed build variant targets the Mac App Store. It leaves the
Developer-ID/DMG pipeline above untouched — it's a config overlay applied on
top of the same sources, not a fork.

```bash
npm run build:mas
```

This runs `scripts/build-mas.mjs`, which:

- applies `src-tauri/tauri.mas.conf.json` on top of `tauri.conf.json` — bundle
  target `app` only, updater artifacts off, the sandbox entitlements, and the
  reduced `mas` capability set (`src-tauri/capabilities/mas.json`) in place of
  `default.json`;
- compiles Rust with the `mas` Cargo feature and the frontend with the
  `__MAS__` Vite define set to `true`, so later work can strip the updater,
  process, and shell-spawn plugins from this variant at compile time;
- generates `src-tauri/Entitlements.mas.plist` from
  `Entitlements.mas.plist.template`, substituting `APPLE_TEAM_ID` and the app
  identifier;
- stamps `CFBundleVersion` from `MAS_BUILD_NUMBER` (the App Store upload
  counter, distinct from the semver).

Building/signing a **submittable** `.app` still needs assets that aren't in the
repo — supply these:

| What | How |
| --- | --- |
| `APPLE_TEAM_ID` | Env var — baked into the entitlements. |
| `APPLE_SIGNING_IDENTITY` | Env var — the **Apple Distribution** identity (e.g. `Apple Distribution: Name (TEAMID)`), read by Tauri to codesign. Distinct from the Developer-ID identity the DMG build uses. |
| `src-tauri/embedded.provisionprofile` | The Mac App Store provisioning profile for `app.capybudget.desktop`, downloaded from the Apple Developer portal. Gitignored. |
| `MAS_BUILD_NUMBER` | Env var — bump per upload. Defaults to `1`. |

Without the team ID / signing identity / profile, `npm run build:mas` still runs
end to end and produces an **unsigned** `.app` (the config path is exercised;
codesigning is skipped). The default target is `universal-apple-darwin`; set
`MAS_TARGET=aarch64-apple-darwin` for faster local iteration. Packaging the
signed `.pkg` and uploading to App Store Connect are separate steps (not yet
wired).

## Documentation

Detailed specs live in [`specs/`](./specs/):

- **[ARCHITECTURE.md](./specs/ARCHITECTURE.md)** — Tech stack, data flow, conventions
- **[MONOREPO.md](./specs/MONOREPO.md)** — Package structure, dependency graph, adapter pattern
- **[INTELLIGENCE.md](./specs/INTELLIGENCE.md)** — AI assistant, MCP server, session interface
- **[DATA_MODEL.md](./specs/DATA_MODEL.md)** — CSV-based data model and schema
