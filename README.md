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

Produces a native `.dmg` (macOS), `.msi` (Windows), or `.deb`/`.AppImage` (Linux).

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

## Documentation

Detailed specs live in [`specs/`](./specs/):

- **[ARCHITECTURE.md](./specs/ARCHITECTURE.md)** — Tech stack, data flow, conventions
- **[MONOREPO.md](./specs/MONOREPO.md)** — Package structure, dependency graph, adapter pattern
- **[INTELLIGENCE.md](./specs/INTELLIGENCE.md)** — AI assistant, MCP server, session interface
- **[DATA_MODEL.md](./specs/DATA_MODEL.md)** — CSV-based data model and schema
