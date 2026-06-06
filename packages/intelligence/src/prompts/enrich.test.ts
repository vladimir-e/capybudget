import { describe, it, expect } from "vitest"
import { ENRICH_SYSTEM_PROMPT } from "./enrich"
import { APP_KNOWLEDGE } from "./app-knowledge"
import { APP_MAP } from "./app-map"

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
})
