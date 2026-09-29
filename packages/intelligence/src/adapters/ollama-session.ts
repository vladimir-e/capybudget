import { ChatCompletionsSession } from "./chat-completions-session"
import type { SessionProvider } from "../types"

export class OllamaSession extends ChatCompletionsSession {
  protected get providerId(): SessionProvider {
    return "ollama"
  }
}
