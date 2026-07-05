import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DEFAULT_INTELLIGENCE_CONFIG, type IntelligenceConfig } from "@capybudget/intelligence"
import { AnthropicConfig } from "./api-provider-config"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  type SecretConfigBackend,
} from "@/stores/intelligence-store"

vi.mock("@/lib/api-testing", () => ({ pingApi: vi.fn() }))

afterEach(cleanup)
beforeEach(() => {
  _resetIntelligenceStoreForTests()
})

// A backend whose on-demand keychain read is held open until `release` is
// called — lets a test interleave user typing with the read resolving.
function backendWithGatedSecrets(config: IntelligenceConfig) {
  let release!: (s: { anthropic: string; openai: string }) => void
  const gate = new Promise<{ anthropic: string; openai: string }>((r) => {
    release = r
  })
  const backend: SecretConfigBackend = {
    load: async () => ({ config, gateSeen: true }),
    loadSecrets: () => gate,
    save: async () => undefined,
    markGateSeen: async () => undefined,
  }
  return { backend, release: () => release }
}

describe("ApiProviderConfig", () => {
  it("keeps the user's in-progress key when an on-demand load resolves mid-typing", async () => {
    const user = userEvent.setup()
    const config: IntelligenceConfig = {
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "anthropic",
      anthropic: { apiKey: "", model: "m", keyPresent: true },
    }
    const { backend, release } = backendWithGatedSecrets(config)
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    render(<AnthropicConfig />)
    const input = screen.getByLabelText("API key") as HTMLInputElement

    // Mount fires ensureSecrets (keyPresent, value not yet loaded); the read is
    // held open. The user types a fresh key before it resolves.
    await user.type(input, "sk-typed")
    expect(input.value).toBe("sk-typed")

    // The read now resolves with the previously-saved key.
    await act(async () => {
      release()({ anthropic: "sk-loaded", openai: "" })
      await Promise.resolve()
    })

    // The resolved value must not clobber the draft the user is editing.
    expect(input.value).toBe("sk-typed")
  })
})
