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

Cutting a release — the direct-download installers and the Mac App Store build, with signing, secrets, and versioning — is documented in [`specs/RELEASING.md`](./specs/RELEASING.md).

## Documentation

Detailed specs live in [`specs/`](./specs/):

- **[ARCHITECTURE.md](./specs/ARCHITECTURE.md)** — Tech stack, data flow, conventions
- **[MONOREPO.md](./specs/MONOREPO.md)** — Package structure, dependency graph, adapter pattern
- **[INTELLIGENCE.md](./specs/INTELLIGENCE.md)** — AI assistant, MCP server, session interface
- **[DATA_MODEL.md](./specs/DATA_MODEL.md)** — CSV-based data model and schema
