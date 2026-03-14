# Capy Budget

A self-contained desktop app for tracking personal finances. Your data lives in plain CSV files in a folder you choose — no cloud, no subscription, no vendor lock-in.

Built with Tauri v2, React, and TypeScript. Optional intelligence layer powered by Claude Code. Structured as an npm workspaces monorepo with shared packages for the desktop app, MCP server, and future web demo.

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

## Project Structure

```
packages/
  core/           — types, money, pure entity services
  persistence/    — repository interface, FileAdapter, CSV implementation
  intelligence/   — session interface, stream events, system prompt
  app/            — full React application (components, hooks, routes)
  mcp/            — standalone MCP server (any AI agent)
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
