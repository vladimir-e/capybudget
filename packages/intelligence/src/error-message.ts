/**
 * Extract a human-readable message from an SDK error.
 *
 * Both Anthropic and OpenAI throw `APIError` instances whose `.message`
 * is `${status} ${stringified-body}` — fine for logs, useless in the chat
 * UI. The cleaner copy is buried in the parsed body the SDK already
 * attached as `.error`. The shapes differ:
 *
 *   Anthropic: `.error = { type: "error", error: { type, message } }`
 *   OpenAI:    `.error = { type, code, message, ... }`  (pre-unwrapped)
 *
 * We duck-type rather than `instanceof`-ing each SDK so this module stays
 * provider-agnostic (intelligence has no SDK deps). Anything that isn't
 * an APIError-shaped object falls back to `Error.message`.
 */
export function extractErrorMessage(err: unknown): { message: string; status?: number } {
  if (!isObject(err)) {
    return { message: String(err) }
  }

  const status = typeof err.status === "number" ? err.status : undefined
  const body = err.error

  // Anthropic — body wraps an inner error object with the real message.
  if (isObject(body) && isObject(body.error) && typeof body.error.message === "string") {
    return { message: body.error.message, status }
  }

  // OpenAI — body itself carries the message (already unwrapped by the SDK).
  if (isObject(body) && typeof body.message === "string") {
    return { message: body.message, status }
  }

  if (err instanceof Error) {
    return status !== undefined ? { message: err.message, status } : { message: err.message }
  }

  return { message: String(err) }
}

const QUOTA_EXHAUSTED = "insufficient_quota"

/** A 429 that asks the caller to slow down. OpenAI also answers an exhausted
 *  quota with 429 — that one is a billing problem, not a rate limit. */
export function isRateLimited(err: unknown): boolean {
  if (!isObject(err) || err.status !== 429) return false
  const body = isObject(err.error) ? err.error : {}
  return ![err.code, body.code, body.type].includes(QUOTA_EXHAUSTED)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
