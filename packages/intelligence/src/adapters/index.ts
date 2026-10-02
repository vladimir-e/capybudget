import type { ApiProvider } from "../config"
import type { ApiAdapterOptions } from "../factory"
import type { CapySession } from "../session"
import type { StructuredSession } from "../structured"
import { AnthropicSession } from "./anthropic-session"
import { OllamaSession } from "./ollama-session"
import { OpenAiSession } from "./openai-session"

export const API_ADAPTERS: Record<ApiProvider, (opts: ApiAdapterOptions) => CapySession & StructuredSession> = {
  anthropic: (opts) => new AnthropicSession(opts),
  openai: (opts) => new OpenAiSession(opts),
  ollama: (opts) => new OllamaSession(opts),
}

export { listModels, pingProvider } from "./providers"
export type { PingResult, PingTarget, ProviderEndpoint } from "./providers"
export { ClaudeCliSession } from "./claude-cli/claude-cli-session"
export type { ClaudeCliHost } from "./claude-cli/claude-cli-session"
