# Structure Refactor — Migration Plan

Plan for converging the codebase onto `specs/STRUCTURE.md`. Audit done on
branch `structure-audit` (forked from `main`, 2026-05). `STRUCTURE.md` + the
spec corrections (this branch / PR #51) are the shipped conventions; this file
is the working migration plan that drives the phased execution.

## Locked decisions

- **Conventions** live in `specs/STRUCTURE.md` (written; bundled into the AI
  spec map like ARCHITECTURE/MONOREPO).
- **AI provider sessions relocate** `app/services` → `intelligence/adapters`.
  Confirmed. DAG stays clean (app already injects via factory constructors).
- Plan is reviewed before execution — phases below are queued, not started.

## Base state

- Branch is current with `main` through **#50 (demo-data generator)**, merged
  in. #50 is isolated to `apps/demo/` (deterministic generator + `profiles/`)
  plus one journey-test swap in `packages/app`; it touches **no**
  core/persistence/intelligence/app production code, so it has **no impact on
  Phases 1–5**. Phase 0 facts re-verified against the merged tree.
- The branch is checked out in the canonical clone `projects/capybudget`
  (node_modules already present — no special setup).

## Verified facts (don't re-derive)

- Dependency graph is **clean**: acyclic, no upward imports, no barrel-bypass.
- `app/lib/mock-data.ts` (462 lines) is **dead** — zero references repo-wide
  (re-confirmed after #50).
- `filterTransactions`/`sortTransactions` live in `app/lib`; the sibling
  `filterTransactionsByDateRange` already lives in `core/analytics.ts`. Split
  logic to consolidate in core.
- Test placement is already consistent (colocated units, journeys in
  `app/src/test/journeys/`). The problem is file size + fixture duplication.
- `makeAccount`/`makeCategory`/`makeTransaction` are redefined ~11× across
  core/persistence/intelligence because they can't import app's factories.

## Per-phase workflow

Each phase: branch off `main` → code **and** tests together → `npm test` +
`npm run lint` green → `code-reviewer` subagent on the diff → commit → PR.

## Phases (ordered by value / ascending risk)

### Phase 0 — quick wins (low risk, small diff)
- Delete `packages/app/src/lib/mock-data.ts` (dead).
- Merge `app/src/providers/` into `app/src/contexts/`; rename
  `repository-provider.ts` → `repository-context.ts` (it's a context, not a
  provider). Update imports.
- (Spec corrections to ARCHITECTURE/TESTING/CLAUDE + the 150-line rule are
  already done on `structure-audit`.)

### Phase 1 — `core` foldering (mechanical, barrel-protected)
- Split `packages/core/src` into `entities/ import/ analytics/ utils/
  constants/` per STRUCTURE.md. Move source + colocated tests together.
- Internal imports become relative-to-subfolder; `index.ts` barrel keeps
  `@capybudget/core` consumers unchanged (verify zero churn outside core).
- Add `packages/core/src/test-factories.ts` (export-only). Replace the ~11
  inline builders in core/persistence/intelligence tests with imports from it.
  Keep persistence's CSV-string builders local.

### Phase 2 — the decoupling lift
- Create `packages/intelligence/src/adapters/`; move `anthropic-session`,
  `openai-session`, `claude-cli-session`, `claude-cli-stream`,
  `claude-cli-detect` (+ their tests) there. Export from intelligence barrel.
  Factory wires them; `app/services/create-session.ts` imports from
  `@capybudget/intelligence`. App keeps only the React context wrapper.
- Move `app/lib/filter-transactions.ts` logic → `core` (consolidate with
  `filterTransactionsByDateRange`).
- Move `src/services/budget-migrations.ts` → `packages/persistence`; shell
  calls `repo.migrate()`.
- Move `app/lib/updater.ts` → desktop shell `src/`.
- Move `app/lib/color-themes.ts` to a config home (with `color-theme-context`).

### Phase 3 — split `intelligence/tools/definitions.ts` (954 lines)
- Break into `definitions/{data,mutation,csv,import,render,read-file,spec}.ts`
  + `definitions/index.ts` aggregator, mirroring `tools/handlers/` 1:1.

### Phase 4 — component decomposition (largest surface; multiple sittings)
Top-down, feature-subfolder pattern, tests split alongside source:
- `capy-overlay.tsx` (1195) → overlay + empty-states + message-bubble +
  block-renderer + `lib/` helpers (~5 files).
- `settings-screen.tsx` (755) → screen + provider-section + **one**
  parametrized api-provider-config (Anthropic/OpenAI blocks are near-dup) +
  `lib/api-testing.ts`.
- `import-screen.tsx` (736) → screen + drop-zone + processing-status + helpers.
- `import-table.tsx` (634) → table + editors + utils.
- `monthly-budget-tab.tsx` (604) → tab + kpi-strip + category-row +
  group-section.
- `transaction-list.tsx` (538) → list + row + utils.
- Leave `budget-shell.tsx` (396) and `transaction-form.tsx` (361) — cohesive.

### Phase 5 — concern-driven test splits
- `csv-transform.test.ts` (1170) → parsing / transforms / variants.
- `claude-cli-stream.test.ts` (809) → text / tools / chips / errors.
- Source-driven splits (analytics, mutation, import-merge) fall out of the
  phases that touch their modules — don't split independently.

## Notes
- Specs are present-tense/as-is. As each phase lands, reconcile any spec that
  describes the moved code (e.g. MONOREPO "What Lives Where" for adapters).
- Keep CHANGELOG entries one line each, per project convention.
- Out of scope but worth a later glance: `apps/demo/src/data/` (the #50
  generator) is a new shell-internal module — sanity-check it against
  STRUCTURE.md when convenient, but it is not part of this refactor.
