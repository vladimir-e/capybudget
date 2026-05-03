import { describe, it, expect, vi } from "vitest"
import {
  createIntelligenceSession,
  type AdapterConstructors,
  type SessionOptions,
} from "./factory"
import { DEFAULT_INTELLIGENCE_CONFIG, type IntelligenceConfig } from "./config"
import type { CapySession } from "./session"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

function makeStubSession(): CapySession {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    isAlive: false,
  }
}

function makeOptions(): SessionOptions {
  return {
    budgetPath: "/budget",
    mcpServerPath: "mcp/server.js",
    systemPrompt: "you are capy",
    onEvent: vi.fn(),
    repo: {} as BudgetRepository,
    fileAdapter: {} as FileAdapter,
  }
}

describe("createIntelligenceSession", () => {
  it("returns null when provider is unconfigured", () => {
    const session = createIntelligenceSession({
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
      adapters: {},
      options: makeOptions(),
    })
    expect(session).toBeNull()
  })

  it("returns null when chosen adapter is not injected", () => {
    const config: IntelligenceConfig = {
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "claude-cli",
    }
    const session = createIntelligenceSession({
      config,
      adapters: {},
      options: makeOptions(),
    })
    expect(session).toBeNull()
  })

  it("invokes the claude-cli ctor with cli-shaped options", () => {
    const ctor = vi.fn().mockImplementation(() => makeStubSession())
    const adapters: AdapterConstructors = { "claude-cli": ctor }
    const opts = makeOptions()
    const session = createIntelligenceSession({
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
      adapters,
      options: opts,
    })
    expect(session).not.toBeNull()
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor).toHaveBeenCalledWith({
      budgetPath: opts.budgetPath,
      mcpServerPath: opts.mcpServerPath,
      systemPrompt: opts.systemPrompt,
      onEvent: opts.onEvent,
    })
  })

  it("returns null for anthropic when api key is empty", () => {
    const ctor = vi.fn()
    const session = createIntelligenceSession({
      config: {
        provider: "anthropic",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
        openai: { apiKey: "", model: "gpt-5" },
      },
      adapters: { anthropic: ctor },
      options: makeOptions(),
    })
    expect(session).toBeNull()
    expect(ctor).not.toHaveBeenCalled()
  })

  it("invokes anthropic ctor with api-shaped options when key is set", () => {
    const ctor = vi.fn().mockImplementation(() => makeStubSession())
    const opts = makeOptions()
    const session = createIntelligenceSession({
      config: {
        provider: "anthropic",
        anthropic: { apiKey: "sk-ant-1", model: "claude-sonnet-4-6" },
        openai: { apiKey: "", model: "gpt-5" },
      },
      adapters: { anthropic: ctor },
      options: opts,
    })
    expect(session).not.toBeNull()
    expect(ctor).toHaveBeenCalledWith({
      budgetPath: opts.budgetPath,
      systemPrompt: opts.systemPrompt,
      apiKey: "sk-ant-1",
      model: "claude-sonnet-4-6",
      onEvent: opts.onEvent,
      repo: opts.repo,
      fileAdapter: opts.fileAdapter,
    })
  })

  it("invokes openai ctor with api-shaped options when key is set", () => {
    const ctor = vi.fn().mockImplementation(() => makeStubSession())
    const opts = makeOptions()
    const session = createIntelligenceSession({
      config: {
        provider: "openai",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
        openai: { apiKey: "sk-openai-1", model: "gpt-5" },
      },
      adapters: { openai: ctor },
      options: opts,
    })
    expect(session).not.toBeNull()
    expect(ctor).toHaveBeenCalledWith({
      budgetPath: opts.budgetPath,
      systemPrompt: opts.systemPrompt,
      apiKey: "sk-openai-1",
      model: "gpt-5",
      onEvent: opts.onEvent,
      repo: opts.repo,
      fileAdapter: opts.fileAdapter,
    })
  })
})
