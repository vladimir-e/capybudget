/**
 * How the orchestrator obtains a {@link StructuredSession}.
 *
 * The structured path targets the in-process API adapters (Anthropic, OpenAI,
 * Ollama), which implement `StructuredSession` alongside `CapySession`. The
 * Claude Code CLI provider's structured call is deferred (per the redesign
 * spec), so it has no `structured()` — this factory returns `null` for it, and
 * Unit 3 gates the UI on {@link canImport}.
 *
 * Distinct from `createIntelligenceSession`: that builds the chat/agent
 * `CapySession`; this builds the import-only structured session with an
 * import-specific system prompt and no agent loop. Both share the
 * app-injected {@link AdapterConstructors} so the package stays platform-free.
 */

import {
  hasModel,
  hasProviderKey,
  resolveApiTarget,
  type IntelligenceConfig,
} from "../config";
import type { AdapterConstructors } from "../factory";
import type { StructuredSession } from "../structured";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

/** Whether a provider can run the structured import pipeline. The CLI provider
 *  is deferred; `null` means AI is off. */
export function canImport(provider: IntelligenceConfig["provider"]): boolean {
  return provider === "anthropic" || provider === "openai" || provider === "ollama";
}

/** Whether an import run can actually start: a provider {@link canImport} can
 *  run AND that provider has a model and (for the hosted APIs) a key configured.
 *  Presence-based, so this is true before the key is fetched from the keychain —
 *  the UI gate reflects "a key is set" without an eager keychain read. The
 *  runtime session build reads the actual key (loaded on demand first) and
 *  guards separately on it. */
export function importReady(config: IntelligenceConfig): boolean {
  switch (config.provider) {
    case "anthropic":
    case "openai": {
      const creds = config[config.provider];
      return hasProviderKey(creds) && hasModel(creds.model);
    }
    case "ollama":
      return hasModel(config.ollama.model);
    default:
      return false;
  }
}

/** Whether a provider can read PDF/document attachments. Anthropic sends PDFs
 *  through the SDK's native `document` type; OpenAI takes them as a `file`
 *  content part on `chat.completions`. Ollama's compatibility shim has no
 *  document part. The Claude CLI's document passthrough is untested and the CLI
 *  is excluded from import anyway (`canImport`), so it stays false. The Import
 *  tab and chat gate PDF drops on this. */
export function canReadPdf(provider: IntelligenceConfig["provider"]): boolean {
  return provider === "anthropic" || provider === "openai";
}

export interface StructuredImportSessionDeps {
  config: IntelligenceConfig;
  adapters: AdapterConstructors;
  options: {
    budgetPath: string;
    systemPrompt: string;
    repo: BudgetRepository;
    fileAdapter: FileAdapter;
    currency: string;
  };
}

/**
 * Build the import structured session, or `null` when the provider can't run it
 * (CLI / off) or isn't configured (see `resolveApiTarget`). The returned
 * session's `structured()` uses the import system prompt and the provider's
 * configured model.
 *
 * The API adapter implements both interfaces; only `structured()` is exercised
 * here. `onEvent` is a no-op — the adapter ctor requires it for its agent-loop
 * path, which the structured calls never take.
 */
export function createStructuredImportSession(
  deps: StructuredImportSessionDeps,
): StructuredSession | null {
  const { config, adapters, options } = deps;
  const target = resolveApiTarget(config);
  if (!target) return null;
  const ctor = adapters[target.provider];
  if (!ctor) return null;

  const session = ctor({
    budgetPath: options.budgetPath,
    systemPrompt: options.systemPrompt,
    apiKey: target.apiKey,
    model: target.model,
    baseUrl: target.baseUrl,
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
