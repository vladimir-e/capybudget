/** The OpenAI adapter pointed at a local Ollama server — see specs/INTELLIGENCE.md. */

import { OpenAiSession } from "./openai-session"
import type { SessionProvider } from "../types"

export class OllamaSession extends OpenAiSession {
  protected override get providerId(): SessionProvider {
    return "ollama"
  }
}
