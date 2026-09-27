import { vi } from "vitest"

export const anthropicList = vi.fn()
export const openAiList = vi.fn()

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    models = { list: anthropicList }
  },
}))

vi.mock("openai", () => ({
  default: class {
    models = { list: openAiList }
  },
}))

export async function* page<T>(items: T[]) {
  yield* items
}

export function failing(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("401 invalid x-api-key")) }),
  }
}

export function deferredPage<T>() {
  let resolve!: (items: T[]) => void
  const items = new Promise<T[]>((r) => {
    resolve = r
  })
  async function* list() {
    yield* await items
  }
  return { list, resolve }
}
