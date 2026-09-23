/**
 * Ollama adapter — the OpenAI transport pointed at a local server.
 *
 * Ollama exposes an OpenAI-compatible surface under `/v1` (chat completions,
 * streaming deltas, tool calls, `response_format: json_schema`), so there is no
 * second client to write: this is {@link OpenAiSession} with a different
 * `baseURL` and a placeholder key, since a local server authenticates nothing.
 * Everything that makes the session work — the agentic loop, tool dispatch,
 * render-block mapping, structured output — is inherited unchanged.
 *
 * Two honest differences from OpenAI, both handled outside this class:
 *   - **No PDF/document parts.** `canReadPdf("ollama")` is false, so callers
 *     never build a `document` block for it.
 *   - **`max_completion_tokens` is not an Ollama parameter.** It rides along in
 *     the request and Ollama ignores unknown fields, which leaves generation
 *     uncapped — acceptable for a local model the user is already paying for
 *     in wall-clock rather than tokens.
 *
 * Whether a given model can call tools or honor a JSON schema is the model's
 * business, not the adapter's; Settings steers users toward tool-capable ones.
 */

import { OpenAiSession } from "./openai-session"
import type { SessionProvider } from "../types"

export class OllamaSession extends OpenAiSession {
  protected override get providerId(): SessionProvider {
    return "ollama"
  }
}
