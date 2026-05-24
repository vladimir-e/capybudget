/**
 * Policy for invalidating budget data after a Capy mutation tool call
 * completes. Extracted from `budget-shell.tsx` so the rule is testable
 * without spinning up the entire shell.
 *
 * The two transports diverge:
 *
 * - **Claude CLI**: mutations route through the MCP server, a separate
 *   process holding its own `BudgetRepository` instance. The UI's repo
 *   has a stale in-memory cache w.r.t. disk, so we drop the cache and
 *   let the next `get*()` re-read.
 *
 * - **API adapters (Anthropic / OpenAI)**: mutations dispatch in-process
 *   against the *same* repo the UI uses. `saveTransactions` already
 *   updated the in-memory cache, and the CSV write is debounced (300ms).
 *   Calling `invalidateCache()` here clears the in-memory truth before
 *   the writer flushes — a second mutation arriving < 300ms later
 *   re-reads stale disk state and overwrites the first. Net effect in a
 *   multi-tool turn: all-but-the-last write silently disappears.
 *
 * Re-fetching the React-Query view is correct for both transports.
 */
import type { IntelligenceProvider } from "@capybudget/intelligence";
import type { DisposableRepository } from "@capybudget/persistence";

export function shouldDropRepoCache(provider: IntelligenceProvider): boolean {
  return provider === "claude-cli";
}

export function invalidateAfterCapyMutation(args: {
  provider: IntelligenceProvider;
  repo: DisposableRepository;
  invalidateQueries: () => void;
}): void {
  if (shouldDropRepoCache(args.provider)) {
    args.repo.invalidateCache?.();
  }
  args.invalidateQueries();
}
