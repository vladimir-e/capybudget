import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import type { ReactNode } from "react"
import { ErrorBoundary } from "./error-boundary"

afterEach(() => {
  cleanup()
})

function Boom(): ReactNode {
  throw new Error("kaboom")
}

describe("ErrorBoundary", () => {
  it("renders the fallback and swallows the error when a child throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() =>
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow()

    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument()

    consoleError.mockRestore()
  })

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>healthy child</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText("healthy child")).toBeInTheDocument()
  })
})
