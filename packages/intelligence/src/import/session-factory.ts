/**
 * How the orchestrator obtains a {@link StructuredSession}.
 *
 * The structured path targets the in-process API adapters (Anthropic, OpenAI,
 * Ollama), which implement `StructuredSession` alongside `CapySession`. The
 * Claude Code CLI has no `structured()`, so this factory returns `null` for it
 * and the UI gates on {@link canImport}.
 *
 * Distinct from `createIntelligenceSession`: that builds the chat/agent
 * `CapySession`; this builds the import-only structured session with an
 * import-specific system prompt and no agent loop. Both take the adapter map
 * injected by the caller (`API_ADAPTERS`), which keeps this module SDK-free.
 */

import {
  hasModel,
  hasProviderKey,
  ollamaOrigin,
  resolveApiTarget,
  type ApiProvider,
  type IntelligenceConfig,
} from "../config";
import type { ApiAdapterOptions } from "../factory";
import type { StructuredSession } from "../structured";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

/** Whether a provider can run the structured import pipeline. The CLI has no
 *  structured call; `null` means AI is off. */
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
 *  through the SDK's native `document` type; OpenAI takes them as an
 *  `input_file` content part. Ollama's compatibility shim has no
 *  document part. The Claude CLI's document passthrough is untested and the CLI
 *  is excluded from import anyway (`canImport`), so it stays false. The Import
 *  tab and chat gate PDF drops on this. */
export function canReadPdf(provider: IntelligenceConfig["provider"]): boolean {
  return provider === "anthropic" || provider === "openai";
}

const OLLAMA_PROBE_TIMEOUT_MS = 5000;

/** Whether a local Ollama model reads images, from the `capabilities` that
 *  `/api/show` reports. Null when the server doesn't say (older Ollama, an
 *  unreachable or stalled server, an aborted run) — the caller warns rather
 *  than guesses. */
export async function ollamaReadsImages(baseUrl: string, model: string, signal?: AbortSignal): Promise<boolean | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, OLLAMA_PROBE_TIMEOUT_MS);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${ollamaOrigin(baseUrl)}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const { capabilities } = (await response.json()) as { capabilities?: unknown };
    return Array.isArray(capabilities) ? capabilities.includes("vision") : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export type StructuredAdapterConstructors = Partial<
  Record<ApiProvider, (opts: ApiAdapterOptions) => StructuredSession>
>;

export interface StructuredImportSessionDeps {
  config: IntelligenceConfig;
  adapters: StructuredAdapterConstructors;
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
 * `onEvent` is a no-op — the adapter ctor requires it for its agent-loop path,
 * which the structured calls never take.
 */
export function createStructuredImportSession(
  deps: StructuredImportSessionDeps,
): StructuredSession | null {
  const { config, adapters, options } = deps;
  const target = resolveApiTarget(config);
  if (!target) return null;
  const ctor = adapters[target.provider];
  if (!ctor) return null;

  return ctor({
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
}
