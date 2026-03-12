# Testing

## Stack

| Tool | Purpose |
|------|---------|
| Vitest | Test runner (shares `vite.config.ts` for aliases and transforms) |
| @testing-library/react | Component rendering and queries for journey tests |
| @testing-library/user-event | Simulated user interactions (click, type, keyboard) |
| jsdom | Browser environment for component tests |

## Test Types

### Unit Tests

Colocated with source files as `*.test.ts`. Test pure functions, services, stores, and repositories in isolation.

```
src/services/accounts.test.ts
src/stores/undo-store.test.ts
src/lib/money.test.ts
```

### User Journey Tests

Full-app integration tests in `src/test/journeys/`. Mount the entire component tree with a memory router and in-memory repository — no file I/O, no Tauri APIs.

```
src/test/journeys/transaction-lifecycle.test.tsx
src/test/journeys/fresh-start.test.tsx
src/test/journeys/account-lifecycle.test.tsx
```

Journey tests exercise real user interactions (open form, type, click, submit) against the complete component tree including routing, TanStack Query, mutations, and undo/redo. They run in ~3s.

## Test Infrastructure

| File | Purpose |
|------|---------|
| `src/test/setup.ts` | Global setup: jest-dom matchers, browser API polyfills, Tauri API mocks |
| `src/test/factories.ts` | `makeAccount()`, `makeCategory()`, `makeTransaction()` — test data builders |
| `src/test/memory-repository.ts` | `BudgetRepository` backed by plain arrays (no persistence) |
| `src/test/render-app.tsx` | `renderApp()` — mounts full app with memory router, fresh QueryClient, cleanup |
| `src/test/journeys/setup.ts` | Mocks `createCsvRepository` → memory repo (import in journey tests only) |

### Writing a Journey Test

```typescript
import "@/test/journeys/setup";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

it("does the thing", async () => {
  const { user, repo } = await renderApp({
    seed: {
      accounts: [makeAccount({ name: "Checking" })],
      categories: [makeCategory({ name: "Groceries" })],
      transactions: [],
    },
  });

  // Wait for the app to load
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });

  // Interact
  await user.click(screen.getByRole("button", { name: /add transaction/i }));
  await user.type(screen.getByPlaceholderText("0.00"), "42");
  await user.keyboard("{Enter}");

  // Assert UI
  const table = screen.getByRole("table");
  expect(within(table).getByText("-$42.00")).toBeInTheDocument();

  // Assert persistence
  expect(repo.data.transactions).toHaveLength(1);
});
```

### Key Gotchas

- **Auto-focus timer**: BudgetShell has an 80ms setTimeout to focus the amount input. In StrictMode this fires twice. Wait for focus before typing: `await waitFor(() => expect(input).toHaveFocus())`.
- **Scoped queries**: Amounts, account names, etc. appear in multiple places (sidebar, table, net worth). Use `within(table)` or `within(dialog)` to scope assertions.
- **Cleanup**: `renderApp` handles QueryClient cleanup between tests automatically. No manual teardown needed.

## Commands

```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Vitest in watch mode
```

## Linting

**ESLint 9** (flat config) with TypeScript, React Hooks, and React Refresh rules. The `react-refresh/only-export-components` rule is disabled for route files and shadcn components since those patterns require multi-export files.
