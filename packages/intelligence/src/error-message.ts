import { UnreachableError } from "./structured"

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
const RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"

/** A 429 that asks the caller to slow down, or an OpenAI stream that failed
 *  mid-response with `rate_limit_exceeded`. OpenAI also answers an exhausted
 *  quota with 429 — that one is a billing problem, not a rate limit. */
export function isRateLimited(err: unknown): boolean {
  if (!isObject(err)) return false
  if (err.code === RATE_LIMIT_EXCEEDED) return true
  if (err.status !== 429) return false
  const body = isObject(err.error) ? err.error : {}
  return ![err.code, body.code, body.type].includes(QUOTA_EXHAUSTED)
}

const TRANSIENT_STREAM_CODES = ["server_error", RATE_LIMIT_EXCEEDED, "vector_store_timeout"]

/** The provider refused this request's content, so retrying the same history
 *  fails the same way. An HTTP status decides when there is one: any 4xx but a
 *  429. Without a status, a string error code decides: anything but a transient
 *  code (`server_error`, `rate_limit_exceeded`, `vector_store_timeout`). An
 *  error with neither — a dropped connection — is not a rejection. */
export function isRejectedRequest(err: unknown): boolean {
  if (!isObject(err)) return false
  const { status, code } = err
  if (typeof status === "number") return status >= 400 && status < 500 && status !== 429
  return typeof code === "string" && !TRANSIENT_STREAM_CODES.includes(code)
}

const DEAD_END_STATUSES = [401, 403, 404]

/** Every further call fails the same way: the key is rejected, the model or
 *  endpoint doesn't exist, or the provider can't be reached at all. */
export function isDeadEnd(err: unknown): boolean {
  if (err instanceof UnreachableError) return true
  return isObject(err) && typeof err.status === "number" && DEAD_END_STATUSES.includes(err.status)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
