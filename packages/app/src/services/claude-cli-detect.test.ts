import { describe, it, expect, vi, beforeEach } from "vitest"

const { execute, create } = vi.hoisted(() => {
  const execute = vi.fn()
  const create = vi.fn(() => ({ execute }))
  return { execute, create }
})

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create },
}))

import {
  detectClaudeCli,
  recheckClaudeCli,
  _resetClaudeCliCacheForTests,
} from "./claude-cli-detect"

beforeEach(() => {
  _resetClaudeCliCacheForTests()
  execute.mockReset()
  create.mockClear()
})

describe("detectClaudeCli", () => {
  it("returns true when claude --version exits 0", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "claude 1.0.0", stderr: "" })
    expect(await detectClaudeCli()).toBe(true)
    expect(create).toHaveBeenCalledWith("claude", ["--version"])
  })

  it("returns false when claude --version exits non-zero", async () => {
    execute.mockResolvedValueOnce({ code: 127, stdout: "", stderr: "command not found" })
    expect(await detectClaudeCli()).toBe(false)
  })

  it("returns false when the command throws (binary missing)", async () => {
    execute.mockRejectedValueOnce(new Error("ENOENT"))
    expect(await detectClaudeCli()).toBe(false)
  })

  it("caches the first result for subsequent calls", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    expect(await detectClaudeCli()).toBe(true)
    expect(await detectClaudeCli()).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent calls into a single probe", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    const [a, b] = await Promise.all([detectClaudeCli(), detectClaudeCli()])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("recheckClaudeCli busts the cache and re-probes", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    expect(await detectClaudeCli()).toBe(true)

    execute.mockResolvedValueOnce({ code: 127, stdout: "", stderr: "" })
    expect(await recheckClaudeCli()).toBe(false)
    expect(create).toHaveBeenCalledTimes(2)
  })
})
