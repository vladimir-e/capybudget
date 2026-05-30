# Code Structure

How code is organized and where new code goes. The dependency graph in
`MONOREPO.md` is the law — acyclic, no upward imports. This file governs the
finer grain: package internals, file placement, and decomposition. When an
agent or contributor is unsure where something belongs, the answer is here.

## Package Layout

A package's `src` stays flat until it reaches ~12 files **or** holds two or
more distinct domains; past that, it splits into domain subfolders. The
`index.ts` barrel is the package's **only** public surface — consumers import
from `@capybudget/<pkg>`, never from a deep internal path. Internal
cross-references use relative paths.

**`core`** groups by domain:

| Subfolder | Holds |
|---|---|
| `entities/` | Account, Category, Transaction services + domain types, bulk ops |
| `import/` | CSV mapping, transform, validation, duplicate detection, merge |
| `analytics/` | Aggregations, time-series, queries |
| `utils/` | money, dates, merchant matching — domain-pure helpers |
| `constants/` | Default categories, label/order tables |

**`persistence`** and **`mcp`** stay flat — they are small and single-domain.
**`intelligence`** groups under `prompts/`, `tools/`, `tools/handlers/`, and
`adapters/` (provider session implementations).

## Placement Law

A file lives in the lowest layer that can own it. The litmus question is *what
does it import?* — not *who uses it.*

| Kind of code | Home | Litmus |
|---|---|---|
| Pure domain logic, transforms, queries | `core` | imports only types / other core |
| Storage, CSV I/O, repository | `persistence` | knows about files, not UI |
| AI provider adapters, session impls | `intelligence/adapters` | imports only `intelligence` types |
| Tool schemas + dispatch | `intelligence/tools` | one file per domain, mirrors handlers |
| React data-to-state bridges | `app/hooks` | no business logic — delegates to core |
| Display | `app/components` | no file I/O, no business logic |
| Platform / Tauri glue, migrations driver | shell `src/` | imports `@tauri-apps/*` |

**If a file imports only `intelligence` types, it does not belong in `app`.**
Provider sessions are adapters: they live in `intelligence/adapters` so any
consumer (the React app, the MCP server, a CLI) reuses them without depending
on `app`. The app keeps only the React context wrapper that injects them.

Schema migrations are a persistence concern — `persistence` owns the
transform; the shell only calls `repo.migrate()`.

## Components

The old "extract at ~150 lines" rule is retired — it described nothing real.
The working guidance:

- Target a component under ~250 lines. Take a hard look past ~400.
- Extract an inline subcomponent to a sibling file once it has its own state
  or is reused. Extract a pure helper down a layer (`lib`, or `core` if
  domain-pure) rather than letting it sit inside a component.
- A genuinely cohesive container (a shell, a single-state form) may run long.
  Length is a smell, not a violation — split when there are seams, not to hit
  a number.

**Feature folders.** Components group by feature (`budget/`, `capy/`,
`import/`, `settings/`). A feature owns its components and any feature-local
helpers; shared primitives live in `components/ui/`. When a single component
spans several files, it gets its own subfolder under the feature.

## The `app/lib` boundary

`app/lib` holds **app-only cross-cutting UI utilities** — class merging,
text/number formatting, theming. It is not a home for business logic (that is
`core`) or for fixtures and demo data (that is test infrastructure). A file
that would compile and pass tests with zero React or DOM imports is a sign it
belongs in `core`.

## Tests

- **Colocate** unit tests as `<source>.test.ts` next to their source.
- **Journey tests** — full-app integration — live in `app/src/test/journeys/`.
- **Shared builders** (`makeAccount`, `makeCategory`, `makeTransaction`) live
  once in `core/src/test-factories.ts` (an export-only module, not a test
  file) and are imported by every package's tests. Packages do not redefine
  their own builders. Persistence's CSV-string builders are the exception —
  they are persistence-specific.
- A test file splits **when its module splits**, not on its own. A test that is
  large only because it exhaustively covers edge cases (parsing, stream
  decoding) may split by concern.

## File Naming

kebab-case throughout (`budget-shell.tsx`, `csv-repository.ts`). See
`ARCHITECTURE.md` for the import-alias conventions (`@capybudget/*`, `@/`).
