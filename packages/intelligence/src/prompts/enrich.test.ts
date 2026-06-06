import { describe, it, expect } from "vitest"
import { ENRICH_INSTRUCTION, ENRICH_SYSTEM_PROMPT } from "./enrich"
import { APP_KNOWLEDGE } from "./app-knowledge"
import { APP_MAP } from "./app-map"
import { getToolDefinitions } from "../tools/definitions"

describe("ENRICH_SYSTEM_PROMPT", () => {
  it("embeds the shared app-knowledge brief", () => {
    expect(ENRICH_SYSTEM_PROMPT).toContain(APP_KNOWLEDGE)
  })

  it("omits the chat-only app map", () => {
    expect(ENRICH_SYSTEM_PROMPT).not.toContain(APP_MAP)
  })

  it("describes the core enrichment loop tools", () => {
    expect(ENRICH_SYSTEM_PROMPT).toContain("enrich_status")
    expect(ENRICH_SYSTEM_PROMPT).toContain("enrich_update")
  })

  it("does not advertise the code-triggered auto_enrich tool", () => {
    // auto_enrich runs as a deterministic pre-pass — the model must not be
    // told to call it (it's gated out of the import surface).
    expect(ENRICH_SYSTEM_PROMPT).not.toContain("`auto_enrich`")
  })

  it("points at search_transactions as a lookup for cryptic descriptions", () => {
    // Without this, the model never reaches for the existing budget
    // history when faced with bank codes like "RBHOOD HGSTS LLC".
    expect(ENRICH_SYSTEM_PROMPT).toContain("search_transactions")
  })

  it("instructs reuse of the user's own past categorization over a fresh guess", () => {
    // Unit 6: the settled choice beats a guess — the prompt must tell the
    // model to look up the merchant's prior category and adopt it.
    const lower = ENRICH_INSTRUCTION.toLowerCase()
    expect(lower).toContain("search_transactions")
    expect(lower).toMatch(/before (guessing|inventing|categorizing)/)
    expect(lower).toMatch(/settled|already (chose|categorized|settled)/)
    // The whole guidance is in the shared body, so re-enrich inherits it.
    expect(ENRICH_SYSTEM_PROMPT).toContain(ENRICH_INSTRUCTION)
  })

  it("reaches search_transactions in import mode (the enrich phase's mode)", () => {
    // The reuse guidance is inert unless the tool is actually advertised to
    // the import session that runs enrich.
    const importTools = getToolDefinitions("import").map((t) => t.name)
    expect(importTools).toContain("search_transactions")
  })
})
