import { describe, it, expect, beforeEach } from "vitest"
import {
  markSkipLaunchRedirect,
  consumeSkipLaunchRedirect,
  setCrashComponentStack,
  getCrashComponentStack,
} from "./crash-recovery"

beforeEach(() => {
  sessionStorage.clear()
  setCrashComponentStack(null)
})

describe("skip-launch marker", () => {
  it("consumes once and is cleared after", () => {
    expect(consumeSkipLaunchRedirect()).toBe(false)
    markSkipLaunchRedirect()
    expect(consumeSkipLaunchRedirect()).toBe(true)
    expect(consumeSkipLaunchRedirect()).toBe(false)
  })
})

describe("crash component stack", () => {
  it("stores and reads the last stack, normalizing nullish to null", () => {
    setCrashComponentStack("\n  at Budget")
    expect(getCrashComponentStack()).toBe("\n  at Budget")
    setCrashComponentStack(undefined)
    expect(getCrashComponentStack()).toBeNull()
  })
})
