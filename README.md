# Capy Budget

A self-contained desktop app for tracking personal finances. Your data lives in plain CSV files in a folder you choose — no cloud, no subscription, no vendor lock-in.

Built with Tauri v2, React, and TypeScript. Optional intelligence layer powered by Claude Code.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Run Locally

```bash
npm install
npm run tauri dev
```

This starts the Vite dev server and opens the Tauri desktop window.

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

## Documentation

Detailed specs live in [`specs/`](./specs/):

- **[PRODUCT.md](./specs/PRODUCT.md)** — Product vision and feature overview
- **[ARCHITECTURE.md](./specs/ARCHITECTURE.md)** — Tech stack, project structure, conventions
- **[DATA_MODEL.md](./specs/DATA_MODEL.md)** — CSV-based data model and schema
