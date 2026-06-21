import { useCallback, useEffect, useMemo } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyProvider } from "@/components/budget/currency-provider";
import { CapySessionProvider } from "@/components/capy/capy-session-provider";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { invalidateAfterCapyMutation } from "@/components/budget/capy-invalidation";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { useAiLanguage } from "@capybudget/i18n";
import { createCsvRepository } from "@capybudget/persistence";
import type { DisposableRepository } from "@capybudget/persistence";
import { tauriFileAdapter } from "../../../../src/adapters/tauri-file-adapter";
import { budgetKeys, useBudgetSnapshot } from "@/hooks/use-budget-data";
import { useBudgetMeta } from "@/hooks/use-budget-meta";
import { useImportStore } from "@/stores/import-store";

interface BudgetSearch {
  path: string;
  name: string;
  section?: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "Budget",
    section: search.section as string | undefined,
  }),
  component: BudgetLayout,
});

// Owns the repo + Capy session for the budget subtree so they survive the
// chrome↔settings swap (disposed only when this layout unmounts).
function BudgetLayout() {
  const { path, name } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const repo = useMemo(() => createCsvRepository(path, tauriFileAdapter), [path]);

  useEffect(() => {
    return () => {
      void repo.dispose().catch((err) => console.error("Failed to dispose repository", err));
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  const provider = useIntelligenceStore((s) => s.config.provider);
  const customInstructions = useCustomInstructions(path);
  const { data: meta } = useBudgetMeta(path);
  const currency = meta.defaultCurrency;
  // Live name comes from budget.json so a rename reflects without a reopen;
  // fall back to the search param only while meta is still loading.
  const budgetName = meta.name || name;
  const language = useAiLanguage();
  const getBudgetSnapshot = useBudgetSnapshot(currency);

  const onDataChanged = useCallback(() => {
    invalidateAfterCapyMutation({
      provider,
      repo: repo as DisposableRepository,
      invalidateQueries: () => queryClient.invalidateQueries({ queryKey: budgetKeys.all }),
    });
  }, [queryClient, repo, provider]);

  // Capy staged the chat attachment(s); send the user to the Import tab and
  // signal it to (re-)check disk + auto-run the orchestrator. The signal covers
  // the case where the user was already on the Import tab — navigation alone
  // wouldn't remount the screen, so its mount effect wouldn't re-fire.
  const signalChatImport = useImportStore((s) => s.signalChatImport);
  const onImportStarted = useCallback(() => {
    signalChatImport();
    void navigate({ to: "/budget/import", search: { path, name: budgetName } });
  }, [signalChatImport, navigate, path, budgetName]);

  const sessionOptions = useMemo(
    () => ({
      budgetPath: path,
      budgetName,
      mcpServerPath: "packages/mcp/src/server.ts",
      customInstructions: customInstructions.instructions,
      getBudgetSnapshot,
      currency,
      currencies: meta.currencies,
      language,
      onDataChanged,
      onImportStarted,
      repo,
      fileAdapter: tauriFileAdapter,
    }),
    [path, budgetName, customInstructions.instructions, getBudgetSnapshot, currency, meta.currencies, language, onDataChanged, onImportStarted, repo],
  );

  return (
    <RepositoryProvider key={path} value={repo}>
      <CurrencyProvider budgetPath={path}>
        <CapySessionProvider key={path} options={sessionOptions}>
          <Outlet />
        </CapySessionProvider>
      </CurrencyProvider>
    </RepositoryProvider>
  );
}
