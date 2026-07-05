import { useCallback, useMemo } from "react";
import {
  ImportOrchestrator,
  FileStagingStore,
  buildImportSystemPrompt,
  canReadPdf,
  createStructuredImportSession,
  importReady,
  type BudgetDataProvider,
} from "@capybudget/intelligence";
import { AnthropicSession, OpenAiSession } from "@capybudget/intelligence/adapters";
import { useBudgetRepository } from "@/contexts/repository-context";
import { useCurrency } from "@/contexts/currency-context";
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

/** Detach and stop whatever run owns the module slot. Called when the active
 *  budget changes: the run belongs to the budget being left, so we drop the
 *  reference (its trailing events are ignored by the identity guard) and ask it
 *  to stop. Its final batch still flushes to *that* budget's staging, which is
 *  correct — resume there picks it up. No-op when idle. */
export function stopActiveOrchestrator(): void {
  const orchestrator = activeOrchestrator;
  activeOrchestrator = null;
  void orchestrator?.stop();
}

/** Per-run hints from the file-attach screen, folded into the session prompt. */
export interface RunOptions {
  /** Name of the account the user picked as the default source account. */
  accountName?: string;
  /** Free-text instructions the user typed (format quirks, account hints). */
  instructions?: string;
}

function composeSystemPrompt(opts?: RunOptions): string {
  const base = buildImportSystemPrompt();
  const extra: string[] = [];
  if (opts?.accountName) {
    extra.push(`Default source account when a row has none: ${opts.accountName}.`);
  }
  const instructions = opts?.instructions?.trim();
  if (instructions) extra.push(instructions);
  if (extra.length === 0) return base;
  return `${base}\n\n## User instructions\n${extra.join("\n")}`;
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
  const currency = useCurrency();
  const config = useIntelligenceStore((s) => s.config);
  const ensureSecrets = useIntelligenceStore((s) => s.ensureSecrets);
  const apply = useImportStore((s) => s.apply);
  const beginRun = useImportStore((s) => s.beginRun);

  const pdfSupported = canReadPdf(config.provider);
  const canStart = importReady(config);

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
      // Read the live config, not the render-time closure: `start`/`enrich`
      // await `ensureSecrets` first, so the freshly-loaded API key is on the
      // store by the time we build here.
      const session = createStructuredImportSession({
        config: useIntelligenceStore.getState().config,
        adapters: {
          anthropic: (o) => new AnthropicSession(o),
          openai: (o) => new OpenAiSession(o),
        },
        options: {
          budgetPath,
          systemPrompt: composeSystemPrompt(opts),
          repo,
          fileAdapter: tauriFileAdapter,
          currency,
        },
      });
      if (!session) return null;
      // Identity guard: a run keeps executing after a cancel/replace clears
      // `activeOrchestrator`, and its trailing events (the in-flight batch's
      // `rows-changed`) would re-flip the store into preview over freshly
      // cleared staging. Drop any event from an orchestrator that is no longer
      // the active one — only the live run drives the UI.
      const orchestrator: ImportOrchestrator = new ImportOrchestrator({
        session,
        staging,
        budget,
        onEvent: (event) => {
          if (activeOrchestrator === orchestrator) apply(event);
        },
      });
      return orchestrator;
    },
    [budgetPath, repo, staging, budget, apply, currency],
  );

  const start = useCallback(
    async (opts?: RunOptions) => {
      await ensureSecrets();
      const orchestrator = buildOrchestrator(opts);
      if (!orchestrator) return false;
      activeOrchestrator = orchestrator;
      beginRun("start");
      void orchestrator.start().finally(() => {
        if (activeOrchestrator === orchestrator) activeOrchestrator = null;
      });
      return true;
    },
    [buildOrchestrator, beginRun, ensureSecrets],
  );

  const enrich = useCallback(
    async (opts?: RunOptions) => {
      await ensureSecrets();
      const orchestrator = buildOrchestrator(opts);
      if (!orchestrator) return false;
      activeOrchestrator = orchestrator;
      beginRun("enrich");
      void orchestrator.enrich().finally(() => {
        if (activeOrchestrator === orchestrator) activeOrchestrator = null;
      });
      return true;
    },
    [buildOrchestrator, beginRun, ensureSecrets],
  );

  /** Request a clean stop of the in-flight run and resolve once the in-flight
   *  batch has settled (landed + persisted). The run's terminal `done` still
   *  flows through, so the bar settles into the resumable preview. Staging is
   *  kept — resume picks it up. No-op when idle. */
  const stop = useCallback(async () => {
    await activeOrchestrator?.stop();
  }, []);

  /** Cancel = stop + discard. Detaches the orchestrator first so its trailing
   *  events (the in-flight batch's `rows-changed`) can't re-flip the store after
   *  the caller clears staging, then awaits the in-flight batch so the clear
   *  races nothing. The caller clears staging once this resolves.
   *
   *  The merge flow reuses this purely for its stop+detach — merge owns the clear
   *  (it writes the chosen rows through, then clears), so the "caller clears
   *  staging" contract holds there too, just via `merge()` rather than discard. */
  const cancel = useCallback(async () => {
    const orchestrator = activeOrchestrator;
    if (!orchestrator) return;
    activeOrchestrator = null;
    await orchestrator.stop();
  }, []);

  return { canStart, pdfSupported, provider: config.provider, start, enrich, stop, cancel, staging };
}
