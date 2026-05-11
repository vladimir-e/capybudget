import { describe, it, expect } from "vitest"
import { ENRICH_SYSTEM_PROMPT } from "./enrich"

describe("ENRICH_SYSTEM_PROMPT", () => {
  it("describes the core enrichment loop tools", () => {
    expect(ENRICH_SYSTEM_PROMPT).toContain("enrich_stats")
    expect(ENRICH_SYSTEM_PROMPT).toContain("enrich_sample")
    expect(ENRICH_SYSTEM_PROMPT).toContain("enrich_update")
  })

  it("points at search_merchants as a lookup for cryptic descriptions", () => {
    // Without this, the model never reaches for the existing merchant
    // history when faced with bank codes like "RBHOOD HGSTS LLC".
    expect(ENRICH_SYSTEM_PROMPT).toContain("search_merchants")
  })
})
