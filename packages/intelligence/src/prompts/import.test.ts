import { describe, it, expect } from "vitest"
import { IMPORT_SYSTEM_PROMPT } from "./import"
import { APP_KNOWLEDGE } from "./app-knowledge"
import { APP_MAP } from "./app-map"

describe("IMPORT_SYSTEM_PROMPT", () => {
  it("embeds the shared app-knowledge brief", () => {
    expect(IMPORT_SYSTEM_PROMPT).toContain(APP_KNOWLEDGE)
  })

  it("omits the chat-only app map", () => {
    expect(IMPORT_SYSTEM_PROMPT).not.toContain(APP_MAP)
  })

  it("keeps the normalize pipeline instructions", () => {
    expect(IMPORT_SYSTEM_PROMPT).toContain("analyze_csv")
    expect(IMPORT_SYSTEM_PROMPT).toContain("preview_transform")
    expect(IMPORT_SYSTEM_PROMPT).toContain("transform_csv")
    expect(IMPORT_SYSTEM_PROMPT).toContain("transactions.csv")
  })
})
