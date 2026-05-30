# Code Structure

Where code goes. `MONOREPO.md` defines the dependency graph (acyclic, no upward
imports); this file governs the finer grain — package internals, file
placement, decomposition. When unsure where something belongs, look here.

## Package Layout

A package's `src` stays flat until ~12 files or two distinct domains, then
splits into domain subfolders. The `index.ts` barrel is the only public
surface: consumers import from `@capybudget/<pkg>`, never a deep path; internal
references are relative.

`core` groups by domain:

| Subfolder | Holds |
|---|---|
| `entities/` | Account, Category, Transaction services + domain types, bulk ops |
| `import/` | CSV mapping, transform, validation, duplicate detection, merge |
| `analytics/` | Aggregations, time-series, queries |
| `utils/` | money, dates, merchant matching |
| `constants/` | Default categories, label/order tables |

`persistence` and `mcp` stay flat (small, single-domain). `intelligence` groups
under `prompts/`, `tools/`, `tools/handlers/`, and `adapters/` (provider
session implementations).

## Placement Law

A file lives in the lowest layer that can own it. The litmus is *what it
imports*, not *who uses it*.

| Code | Home | Litmus |
|---|---|---|
| Pure domain logic, transforms, queries | `core` | imports only types / other core |
| Storage, CSV I/O, repository | `persistence` | knows files, not UI |
| AI provider adapters, sessions | `intelligence/adapters` | imports only `intelligence` types |
| Tool schemas + dispatch | `intelligence/tools` | one file per domain, mirrors handlers |
| React data-to-state bridges | `app/hooks` | delegates to core, no business logic |
| Display | `app/components` | no file I/O, no business logic |
| Platform / Tauri glue | shell `src/` | imports `@tauri-apps/*` |

A file that imports only `intelligence` types belongs there, not in `app`:
provider sessions live in `intelligence/adapters` so any consumer (the app, the
MCP server, a CLI) reuses them without depending on `app`, and the app keeps
only the React context wrapper that injects them. Schema migrations are a
persistence concern — `persistence` owns the transform, the shell calls
`repo.migrate()`.

## Components

- A component targets under ~250 lines; past ~400, look for seams. Length is a
  smell, not a limit — a cohesive container (a shell, a single-state form) may
  run long. Split where the seams are, not to hit a number.
- Extract an inline subcomponent to a sibling file once it owns state or is
  reused; push a pure helper down a layer (`lib`, or `core` if domain-pure)
  rather than nesting it.
- Components group by feature (`budget/`, `capy/`, `import/`, `settings/`): a
  feature owns its components and local helpers, shared primitives live in
  `components/ui/`, and a component spanning several files gets its own
  subfolder.

## The `app/lib` boundary

`app/lib` holds app-only cross-cutting UI utilities — class merging,
text/number formatting, theming. Not business logic (that is `core`), not
fixtures or demo data (that is test infrastructure). A file that would compile
and pass tests with zero React or DOM imports belongs in `core`.

## Tests

- Colocate unit tests as `<source>.test.ts`; full-app journey tests live in
  `app/src/test/journeys/`.
- Shared builders (`makeAccount`, `makeCategory`, `makeTransaction`) live once
  in `core/src/test-factories.ts` (export-only, not a test file) and are
  imported everywhere — packages do not redefine them. Persistence's CSV-string
  builders are the exception.
- A test splits when its module splits; one bloated only by exhaustive edge
  cases (parsing, stream decoding) may split by concern.

## File Naming

kebab-case throughout (`budget-shell.tsx`, `csv-repository.ts`). Import aliases
(`@capybudget/*`, `@/`) are in `ARCHITECTURE.md`.
