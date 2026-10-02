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
  MIN_CLAUDE_CLI_VERSION,
} from "./claude-cli-detect"

beforeEach(() => {
  _resetClaudeCliCacheForTests()
  execute.mockReset()
  create.mockClear()
})

describe("detectClaudeCli", () => {
  it("is ready when claude --version exits 0 with a supported version", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: `${MIN_CLAUDE_CLI_VERSION} (Claude Code)`, stderr: "" })
    expect(await detectClaudeCli()).toBe("ready")
    expect(create).toHaveBeenCalledWith("claude", ["--version"])
  })

  it.each([
    ["2.1.247 (Claude Code)", "outdated"],
    ["1.9.999 (Claude Code)", "outdated"],
    ["2.2.0 (Claude Code)", "ready"],
    ["3.0.0", "ready"],
    ["my-claude-wrapper", "ready"],
  ])("reads %s as %s", async (stdout, status) => {
    execute.mockResolvedValueOnce({ code: 0, stdout, stderr: "" })
    expect(await detectClaudeCli()).toBe(status)
  })

  it("is missing when claude --version exits non-zero", async () => {
    execute.mockResolvedValueOnce({ code: 127, stdout: "", stderr: "command not found" })
    expect(await detectClaudeCli()).toBe("missing")
  })

  it("is missing when the command throws (binary missing)", async () => {
    execute.mockRejectedValueOnce(new Error("ENOENT"))
    expect(await detectClaudeCli()).toBe("missing")
  })

  it("caches the first result for subsequent calls", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    expect(await detectClaudeCli()).toBe("ready")
    expect(await detectClaudeCli()).toBe("ready")
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent calls into a single probe", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    const [a, b] = await Promise.all([detectClaudeCli(), detectClaudeCli()])
    expect(a).toBe("ready")
    expect(b).toBe("ready")
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("recheckClaudeCli busts the cache and re-probes", async () => {
    execute.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    expect(await detectClaudeCli()).toBe("ready")

    execute.mockResolvedValueOnce({ code: 127, stdout: "", stderr: "" })
    expect(await recheckClaudeCli()).toBe("missing")
    expect(create).toHaveBeenCalledTimes(2)
  })
})
