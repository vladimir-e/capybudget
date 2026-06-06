import { describe, it, expect } from "vitest";
import { resolveReconnect } from "./import-reconnect";

describe("resolveReconnect", () => {
  it("no CSV → empty (drop zone / file list)", () => {
    expect(resolveReconnect(false, false)).toEqual({ kind: "empty" });
    // enriched is moot without a CSV.
    expect(resolveReconnect(false, true)).toEqual({ kind: "empty" });
  });

  it("CSV present + enriched → review, no enrich", () => {
    expect(resolveReconnect(true, true)).toEqual({ kind: "review" });
  });

  it("CSV present + not enriched → resume the post-normalize run", () => {
    // Interrupted run: normalize wrote the CSV, the run never finished.
    expect(resolveReconnect(true, false)).toEqual({ kind: "resume-run" });
  });
});
