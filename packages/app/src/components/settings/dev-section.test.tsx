import { Component, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ path: "/tmp/budget", name: "Test Budget" }),
}))

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.0.0"),
  getTauriVersion: vi.fn().mockResolvedValue("2.0.0"),
}))

import { DevSection } from "./dev-section"

class TestBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <div role="alert">caught: {this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

afterEach(() => {
  cleanup()
})

describe("DevSection", () => {
  it("renders diagnostics and propagates a render throw on trigger", async () => {
    // The boundary catch logs the error; silence it for clean test output.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const user = userEvent.setup()

    render(
      <TestBoundary>
        <DevSection />
      </TestBoundary>,
    )

    expect(screen.getByText("App version")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /trigger error screen/i }))

    expect(screen.getByRole("alert")).toHaveTextContent(/forced crash/i)

    errorSpy.mockRestore()
  })
})
