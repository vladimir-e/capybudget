import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"

const { checkMock, toastMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock("@/lib/updater", () => ({
  checkForUpdate: checkMock,
}))

vi.mock("sonner", () => ({
  toast: toastMock,
}))

import { useStartupUpdateCheck } from "./use-startup-update-check"

function setTauri(present: boolean) {
  if (present) {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  }
}

// Let the deferred setTimeout callback fire and the awaited checkForUpdate
// promise chain settle before asserting on the toast.
async function flush() {
  await vi.runAllTimersAsync()
}

beforeEach(() => {
  vi.useFakeTimers()
  checkMock.mockReset()
  toastMock.mockReset()
})

afterEach(() => {
  setTauri(false)
  vi.useRealTimers()
})

describe("useStartupUpdateCheck", () => {
  it("does nothing outside Tauri", async () => {
    setTauri(false)
    const navigate = vi.fn()
    checkMock.mockResolvedValue({ version: "2.0.0" })

    renderHook(() => useStartupUpdateCheck({ path: "/b", name: "B", navigate }))
    await flush()

    expect(checkMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("toasts once with a deep-link action when an update is found", async () => {
    setTauri(true)
    const navigate = vi.fn()
    checkMock.mockResolvedValue({ version: "2.0.0" })

    renderHook(() => useStartupUpdateCheck({ path: "/b", name: "B", navigate }))
    await flush()

    expect(checkMock).toHaveBeenCalledOnce()
    expect(toastMock).toHaveBeenCalledOnce()
    const [message, opts] = toastMock.mock.calls[0]
    expect(message).toBe("Capy 2.0.0 available")

    opts.action.onClick()
    expect(navigate).toHaveBeenCalledWith({
      to: "/budget/settings",
      search: { path: "/b", name: "B", section: "updates" },
    })
  })

  it("does not toast when no update is available", async () => {
    setTauri(true)
    const navigate = vi.fn()
    checkMock.mockResolvedValue(null)

    renderHook(() => useStartupUpdateCheck({ path: "/b", name: "B", navigate }))
    await flush()

    expect(checkMock).toHaveBeenCalledOnce()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("fires the check once across re-renders", async () => {
    setTauri(true)
    const navigate = vi.fn()
    checkMock.mockResolvedValue(null)

    const { rerender } = renderHook(
      (props: { path: string; name: string }) =>
        useStartupUpdateCheck({ ...props, navigate }),
      { initialProps: { path: "/b", name: "B" } },
    )
    rerender({ path: "/b2", name: "B2" })
    await flush()

    expect(checkMock).toHaveBeenCalledOnce()
  })

  it("deep-links to the budget open when the toast is clicked, not first mount", async () => {
    setTauri(true)
    const navigate = vi.fn()
    checkMock.mockResolvedValue({ version: "2.0.0" })

    const { rerender } = renderHook(
      (props: { path: string; name: string }) =>
        useStartupUpdateCheck({ ...props, navigate }),
      { initialProps: { path: "/b", name: "B" } },
    )
    rerender({ path: "/b2", name: "B2" })
    await flush()

    const [, opts] = toastMock.mock.calls[0]
    opts.action.onClick()
    expect(navigate).toHaveBeenCalledWith({
      to: "/budget/settings",
      search: { path: "/b2", name: "B2", section: "updates" },
    })
  })
})
