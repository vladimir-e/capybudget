# Capy Budget

A self-contained desktop app for tracking personal finances. Your data lives in plain CSV files in a folder you choose — no cloud, no subscription, no vendor lock-in.

Built with Tauri v2, React, and TypeScript. Optional intelligence layer powered by Claude Code, the Anthropic API, or the OpenAI API. Structured as an npm workspaces monorepo with shared packages for the desktop app, MCP server, web demo, and promo website.

**[capybudget.app](https://capybudget.app)** | **[Demo](https://demo.capybudget.app)**

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

### Configure the AI Provider

The first time you open the app, click the gear icon in the header to open **Settings** and pick an AI provider — Claude Code (local CLI), Anthropic API, or OpenAI API. API keys are stored locally in your app config folder.

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

Releases are cut from `main` via a tag. The `release.yml` workflow then builds
and signs installers for macOS, Windows, and Linux, attaches them to a GitHub
Release, and publishes a Tauri updater manifest (`latest.json`) so existing
installs can auto-update.

```bash
npm run release 0.2.0      # bumps versions, commits, tags v0.2.0
git push --follow-tags     # triggers the Release workflow
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

After running `tauri signer generate`, paste the **public key** into
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, replacing the
`__REPLACE_WITH_TAURI_UPDATER_PUBKEY__` placeholder) and add the **private
key + password** as repo secrets above.

### Demo & Website

```bash
npm run demo              # Web demo dev server (:3000)
npm run www               # Promo website dev server (:3001)
```

## Project Structure

```
packages/
  core/           — types, money, pure entity services
  persistence/    — repository interface, FileAdapter, CSV implementation
  intelligence/   — session interface, stream events, system prompt
  app/            — full React application (components, hooks, routes)
  mcp/            — standalone MCP server (any AI agent)
apps/
  demo/           — browser-based demo with preset data (demo.capybudget.app)
  www/            — promo website, Astro static site (capybudget.app)
src/              — desktop shell (Tauri adapters + entry point)
```

See [`specs/MONOREPO.md`](./specs/MONOREPO.md) for the full dependency graph and adapter pattern.

## Documentation

Detailed specs live in [`specs/`](./specs/):

- **[PRODUCT.md](./specs/PRODUCT.md)** — Product vision and feature overview
- **[ARCHITECTURE.md](./specs/ARCHITECTURE.md)** — Tech stack, data flow, conventions
- **[MONOREPO.md](./specs/MONOREPO.md)** — Package structure, dependency graph, adapter pattern
- **[INTELLIGENCE.md](./specs/INTELLIGENCE.md)** — AI assistant, MCP server, session interface
- **[DATA_MODEL.md](./specs/DATA_MODEL.md)** — CSV-based data model and schema
