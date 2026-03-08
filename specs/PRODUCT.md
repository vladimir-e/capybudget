# Product Vision

**Capy Budget** is a self-contained desktop app for tracking personal finances across every account you own — wallet, checking, savings, crypto, gold pile.

## Philosophy

- **No cloud, no subscription.** Your data lives in plain CSV files in a folder you choose.
- **No opinionated methodology.** The app tracks what happened — you decide how to budget.
- **Sync for free.** Point the data folder at iCloud or Dropbox and get cross-device sync without a backend.
- **Intelligence is optional.** An optional layer powered by Claude Code adds smart import, auto-categorization, and natural language insights. The app is fully functional without it.

## Core Principle

Accounts are the atomic unit of your financial picture. Every feature derives from a simple, well-maintained transaction database. The complexity of maintaining that database is where intelligence makes the difference.

## Key Features

### Budget Management
- Create and manage multiple budgets, each stored in its own folder
- Accounts of any type: cash, checking, savings, credit card, loan, asset, crypto
- Fully customizable categories with sensible defaults
- Transaction tracking with income, expense, and transfer types

### Intelligence Layer (Claude Code)
- **Smart import** — paste a bank screenshot or CSV, Claude parses it, you review and confirm
- **Auto-categorization** — learns from your existing spending patterns
- **Insights** — natural language queries about your spending
- **Anomaly detection** — flags unusual transactions or spending spikes

### Data Ownership
- All data in human-readable CSV files
- No database engine, no binary formats
- Inspect, edit, or version-control your finances with any tool
- Trivial to import/export anywhere

## Target Platform

macOS first (native .dmg via Tauri). Windows and Linux possible via Tauri cross-compilation.

## Distribution

Open source, MIT license. Public GitHub repo with a clean README and architecture docs.
