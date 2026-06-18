/**
 * How the orchestrator obtains a {@link StructuredSession}.
 *
 * The structured path targets the in-process API adapters (Anthropic, OpenAI),
 * which implement `StructuredSession` alongside `CapySession`. The Claude Code
 * CLI provider's structured call is deferred (per the redesign spec), so it has
 * no `structured()` — this factory returns `null` for it, and Unit 3 gates the
 * UI on {@link canImport} ("import needs Anthropic or OpenAI for now").
 *
 * Distinct from `createIntelligenceSession`: that builds the chat/agent
 * `CapySession`; this builds the import-only structured session with an
 * import-specific system prompt and no agent loop. Both share the
 * app-injected {@link AdapterConstructors} so the package stays platform-free.
 */

import type { IntelligenceConfig } from "../config";
import type { AdapterConstructors } from "../factory";
import type { StructuredSession } from "../structured";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

/** Whether a provider can run the structured import pipeline. The CLI provider
 *  is deferred; `null` means AI is off. */
export function canImport(provider: IntelligenceConfig["provider"]): boolean {
  return provider === "anthropic" || provider === "openai";
}

/** Whether a provider can read PDF/document attachments. Anthropic sends PDFs
 *  through the SDK's native `document` type; OpenAI's `chat.completions` can't
 *  read documents — the adapter swaps a PDF for a placeholder note, so a PDF
 *  import would reach the model as text the user never sees. The Import tab gates
 *  PDF drops on this so an OpenAI user can't start an import the model is blind
 *  to. (`canImport` already excludes the CLI provider entirely.) */
export function canReadPdf(provider: IntelligenceConfig["provider"]): boolean {
  return provider === "anthropic";
}

export interface StructuredImportSessionDeps {
  config: IntelligenceConfig;
  adapters: AdapterConstructors;
  options: {
    budgetPath: string;
    systemPrompt: string;
    repo: BudgetRepository;
    fileAdapter: FileAdapter;
    /** The budget's display currency (ISO 4217). */
    currency: string;
  };
}

/**
 * Build the import structured session, or `null` when the provider can't run it
 * (CLI / off) or its API key is missing. The returned session's `structured()`
 * uses the import system prompt and the provider's configured model.
 *
 * The API adapter implements both interfaces; only `structured()` is exercised
 * here. `onEvent` is a no-op — the adapter ctor requires it for its agent-loop
 * path, which the structured calls never take.
 */
export function createStructuredImportSession(
  deps: StructuredImportSessionDeps,
): StructuredSession | null {
  const { config, adapters, options } = deps;
  const provider = config.provider;
  if (!canImport(provider)) return null;

  const providerConfig = provider === "anthropic" ? config.anthropic : config.openai;
  if (!providerConfig.apiKey) return null;
  const ctor = provider === "anthropic" ? adapters.anthropic : adapters.openai;
  if (!ctor) return null;

  const session = ctor({
    budgetPath: options.budgetPath,
    systemPrompt: options.systemPrompt,
    apiKey: providerConfig.apiKey,
    model: providerConfig.model,
    onEvent: () => {},
    repo: options.repo,
    fileAdapter: options.fileAdapter,
    currency: options.currency,
  });

  // The API adapters implement StructuredSession; verify the surface is
  // actually there before narrowing, so a provider that can't do structured
  // calls fails honestly at the gate rather than deep inside Normalizing.
  const candidate = session as unknown as Partial<StructuredSession>;
  if (typeof candidate.structured !== "function") return null;
  return candidate as StructuredSession;
}
