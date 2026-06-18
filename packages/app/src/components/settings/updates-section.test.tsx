import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const { checkMock, installMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  installMock: vi.fn(),
}))

vi.mock("@/lib/updater", () => ({
  checkForUpdate: checkMock,
  installUpdate: installMock,
}))

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.2.3"),
}))

import { UpdatesSection } from "./updates-section"

beforeEach(() => {
  checkMock.mockReset()
  installMock.mockReset()
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe("UpdatesSection", () => {
  it("reports up-to-date when the on-mount check finds no update", async () => {
    checkMock.mockResolvedValue(null)
    render(<UpdatesSection />)

    expect(
      await screen.findByText("You're on the latest version."),
    ).toBeInTheDocument()
  })

  it("surfaces the new version when the on-mount check finds an update", async () => {
    checkMock.mockResolvedValue({ version: "2.0.0", downloadAndInstall: vi.fn() })
    render(<UpdatesSection />)

    expect(await screen.findByText("Capy 2.0.0 is available.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /install & restart/i }),
    ).toBeInTheDocument()
  })

  it("shows a readable message when the check fails", async () => {
    checkMock.mockRejectedValue(new Error("network unreachable"))
    render(<UpdatesSection />)

    expect(await screen.findByText("network unreachable")).toBeInTheDocument()
  })

  it("re-checks when the manual button is clicked", async () => {
    const user = userEvent.setup()
    checkMock.mockResolvedValueOnce(null)
    render(<UpdatesSection />)

    await screen.findByText("You're on the latest version.")

    checkMock.mockResolvedValueOnce({ version: "2.0.0", downloadAndInstall: vi.fn() })
    await user.click(screen.getByRole("button", { name: /check for updates/i }))

    expect(await screen.findByText("Capy 2.0.0 is available.")).toBeInTheDocument()
  })

  it("drives the progress bar while installing an available update", async () => {
    const user = userEvent.setup()
    const update = { version: "2.0.0", downloadAndInstall: vi.fn() }
    checkMock.mockResolvedValue(update)

    let resolveInstall: (() => void) | undefined
    installMock.mockImplementation((_u, onProgress) => {
      onProgress?.({ downloaded: 50, total: 100 })
      return new Promise<void>((resolve) => {
        resolveInstall = resolve
      })
    })
    render(<UpdatesSection />)

    await user.click(
      await screen.findByRole("button", { name: /install & restart/i }),
    )

    // While the install promise is pending, the downloading branch renders.
    expect(await screen.findByText(/Downloading… 50%/)).toBeInTheDocument()

    resolveInstall?.()

    await waitFor(() => {
      expect(screen.getByText(/Restarting/)).toBeInTheDocument()
    })
    expect(installMock).toHaveBeenCalledWith(update, expect.any(Function))
  })
})
