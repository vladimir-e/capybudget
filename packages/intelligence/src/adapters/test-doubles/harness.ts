import { vi } from "vitest"
import type { StreamEvent } from "../../types"

export const mockRunTool = vi.fn<(name: string, input: Record<string, unknown>, ctx: unknown) => Promise<string>>()

export async function toolsWithMockedRun(importOriginal: () => Promise<unknown>) {
  return { ...(await importOriginal() as Record<string, unknown>), runTool: mockRunTool }
}

/** Every tool call hangs until the test resolves it, in call order. */
export function blockingTools() {
  const resolvers: Array<(v: string) => void> = []
  mockRunTool.mockImplementation(() => new Promise<string>((resolve) => resolvers.push(resolve)))
  return {
    resolvers,
    started: () =>
      vi.waitFor(() => {
        if (resolvers.length === 0) throw new Error("not yet")
      }),
  }
}

export function lastBlocks(events: readonly StreamEvent[]) {
  const last = events.filter((e) => e.type === "content").pop()
  if (last?.type !== "content") throw new Error("expected content event")
  return last.blocks
}
