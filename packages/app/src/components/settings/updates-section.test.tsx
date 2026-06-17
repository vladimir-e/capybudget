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
})

afterEach(() => {
  cleanup()
})

describe("UpdatesSection", () => {
  it("reports up-to-date when no update is available", async () => {
    const user = userEvent.setup()
    checkMock.mockResolvedValue(null)
    render(<UpdatesSection />)

    await user.click(screen.getByRole("button", { name: /check for updates/i }))

    expect(
      await screen.findByText("You're on the latest version."),
    ).toBeInTheDocument()
  })

  it("surfaces the new version when an update is available", async () => {
    const user = userEvent.setup()
    checkMock.mockResolvedValue({ version: "2.0.0", downloadAndInstall: vi.fn() })
    render(<UpdatesSection />)

    await user.click(screen.getByRole("button", { name: /check for updates/i }))

    expect(await screen.findByText("Capy 2.0.0 is available.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /install & restart/i }),
    ).toBeInTheDocument()
  })

  it("shows a readable message when the check fails", async () => {
    const user = userEvent.setup()
    checkMock.mockRejectedValue(new Error("network unreachable"))
    render(<UpdatesSection />)

    await user.click(screen.getByRole("button", { name: /check for updates/i }))

    expect(await screen.findByText("network unreachable")).toBeInTheDocument()
  })

  it("drives the progress bar while installing an available update", async () => {
    const user = userEvent.setup()
    const update = { version: "2.0.0", downloadAndInstall: vi.fn() }
    checkMock.mockResolvedValue(update)
    installMock.mockImplementation(async (_u, onProgress) => {
      onProgress?.({ downloaded: 50, total: 100 })
    })
    render(<UpdatesSection />)

    await user.click(screen.getByRole("button", { name: /check for updates/i }))
    await user.click(
      await screen.findByRole("button", { name: /install & restart/i }),
    )

    await waitFor(() => {
      expect(screen.getByText(/Restarting/)).toBeInTheDocument()
    })
    expect(installMock).toHaveBeenCalledWith(update, expect.any(Function))
  })
})
