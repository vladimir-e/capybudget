import { useCallback, useMemo } from "react";
import {
  ImportOrchestrator,
  FileStagingStore,
  IMPORT_STRUCTURED_SYSTEM_PROMPT,
  canImport,
  createStructuredImportSession,
  type BudgetDataProvider,
} from "@capybudget/intelligence";
import { AnthropicSession, OpenAiSession } from "@capybudget/intelligence/adapters";
import { useBudgetRepository } from "@/contexts/repository-context";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { useImportStore } from "@/stores/import-store";
import { tauriFileAdapter } from "../../../../src/adapters/tauri-file-adapter";

/**
 * The orchestrator instance for the run currently in flight, held outside React
 * so the `stop()` handle survives navigation. A run keeps executing while the
 * user is on another tab (its promise is in flight); without this, the Import
 * screen remounting would lose the only reference able to interrupt it. One
 * active import at a time is the product invariant, so a single module-level
 * slot is enough.
 */
let activeOrchestrator: ImportOrchestrator | null = null;

/** Per-run hints from the file-attach screen, folded into the session prompt. */
export interface RunOptions {
  /** Name of the account the user picked as the default source account. */
  accountName?: string;
  /** Free-text instructions the user typed (format quirks, account hints). */
  instructions?: string;
}

function composeSystemPrompt(opts?: RunOptions): string {
  const extra: string[] = [];
  if (opts?.accountName) {
    extra.push(`Default source account when a row has none: ${opts.accountName}.`);
  }
  const instructions = opts?.instructions?.trim();
  if (instructions) extra.push(instructions);
  if (extra.length === 0) return IMPORT_STRUCTURED_SYSTEM_PROMPT;
  return `${IMPORT_STRUCTURED_SYSTEM_PROMPT}\n\n## User instructions\n${extra.join("\n")}`;
}

/**
 * Drives the headless import orchestrator from the app.
 *
 * Constructs an {@link ImportOrchestrator} per run with the three injected seams
 * Unit 2 left open: the {@link FileStagingStore} over the Tauri file adapter
 * (`.capy/import/` on disk), a {@link BudgetDataProvider} backed by the budget
 * repository (the History phase's read-only corpus), and a structured session
 * for the provider's model. Events flow straight into the import store, which
 * the progress UI renders.
 *
 * `start` / `enrich` / `stop` are the driver API. The store's `running` flag and
 * disk staging — not this hook — are the resume authority, so the hook holds no
 * run state of its own; a navigation away and back re-derives everything from
 * staging.
 */
export function useImportOrchestrator(budgetPath: string) {
  const repo = useBudgetRepository();
  const config = useIntelligenceStore((s) => s.config);
  const apply = useImportStore((s) => s.apply);
  const beginRun = useImportStore((s) => s.beginRun);

  const supported = canImport(config.provider);

  const staging = useMemo(
    () => new FileStagingStore(tauriFileAdapter, budgetPath),
    [budgetPath],
  );

  const budget = useMemo<BudgetDataProvider>(
    () => ({
      getHistory: () => repo.getTransactions(),
      getCategories: () => repo.getCategories(),
      getAccounts: () => repo.getAccounts(),
    }),
    [repo],
  );

  /** Build a fresh orchestrator + session per run. The session is single-shot
   *  by design (stateless calls), and a fresh orchestrator guarantees its
   *  internal `running`/`stopRequested` flags start clean — resume safety lives
   *  in staging, not in a long-lived instance. Returns null when the provider
   *  can't run structured imports (CLI / off / missing key).
   *
   *  The default account + free-text instructions from the file-attach screen
   *  ride into the session's system prompt — it's the one channel both stateless
   *  calls (mapping/extraction and enrich) see, so a "treat unlabeled rows as my
   *  Checking account" or "amounts are in the Debit/Credit columns" hint reaches
   *  the mapper without changing the engine's per-call signatures. */
  const buildOrchestrator = useCallback(
    (opts?: RunOptions): ImportOrchestrator | null => {
      const session = createStructuredImportSession({
        config,
        adapters: {
          anthropic: (o) => new AnthropicSession(o),
          openai: (o) => new OpenAiSession(o),
        },
        options: {
          budgetPath,
          systemPrompt: composeSystemPrompt(opts),
          repo,
          fileAdapter: tauriFileAdapter,
        },
      });
      if (!session) return null;
      return new ImportOrchestrator({ session, staging, budget, onEvent: apply });
    },
    [config, budgetPath, repo, staging, budget, apply],
  );

  const start = useCallback(
    (opts?: RunOptions) => {
      const orchestrator = buildOrchestrator(opts);
      if (!orchestrator) return false;
      activeOrchestrator = orchestrator;
      beginRun("start");
      void orchestrator.start().finally(() => {
        if (activeOrchestrator === orchestrator) activeOrchestrator = null;
      });
      return true;
    },
    [buildOrchestrator, beginRun],
  );

  const enrich = useCallback(
    (opts?: RunOptions) => {
      const orchestrator = buildOrchestrator(opts);
      if (!orchestrator) return false;
      activeOrchestrator = orchestrator;
      beginRun("enrich");
      void orchestrator.enrich().finally(() => {
        if (activeOrchestrator === orchestrator) activeOrchestrator = null;
      });
      return true;
    },
    [buildOrchestrator, beginRun],
  );

  /** Request a clean stop of the in-flight run. The in-flight batch lands and
   *  persists; resume picks up from staging. No-op when nothing is running. */
  const stop = useCallback(() => {
    activeOrchestrator?.stop();
  }, []);

  return { supported, start, enrich, stop, staging };
}
