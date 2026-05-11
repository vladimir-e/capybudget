import { describe, it, expect } from "vitest"
import { handleReadSpec } from "./spec"
import { SPECS, SPEC_FILENAMES } from "../../specs.generated"

describe("handleReadSpec", () => {
  it("returns the content of a known spec by exact filename", async () => {
    const out = await handleReadSpec({ filename: "DATA_MODEL.md" })
    expect(out).toBe(SPECS["DATA_MODEL.md"])
    expect(out).toContain("# Data Model")
  })

  it("rejects an unknown filename and lists what's available", async () => {
    let caught: Error | undefined
    try {
      await handleReadSpec({ filename: "made-up.md" })
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).toContain("Unknown spec 'made-up.md'")
    // The available list must surface so the model can self-correct.
    for (const name of SPEC_FILENAMES) {
      expect(caught?.message).toContain(name)
    }
  })

  it("rejects path traversal attempts as unknown specs", async () => {
    // The bundled map is keyed by bare filename. Anything with a slash
    // or `..` falls through to the unknown-spec path — there is no
    // filesystem surface to reach for.
    await expect(
      handleReadSpec({ filename: "../../etc/passwd" }),
    ).rejects.toThrow(/Unknown spec/)
    await expect(
      handleReadSpec({ filename: "specs/DATA_MODEL.md" }),
    ).rejects.toThrow(/Unknown spec/)
    await expect(
      handleReadSpec({ filename: "/DATA_MODEL.md" }),
    ).rejects.toThrow(/Unknown spec/)
  })

  it("rejects missing filename with the available list", async () => {
    await expect(handleReadSpec({})).rejects.toThrow(/Missing filename/)
    await expect(handleReadSpec({ filename: "" })).rejects.toThrow(
      /Missing filename/,
    )
    await expect(
      handleReadSpec({ filename: 42 as unknown as string }),
    ).rejects.toThrow(/Missing filename/)
  })
})
