/**
 * Recharts spreads the underlying data record into the event arg *and*
 * exposes it as `.payload`. Prefer `.payload` (stable across recharts
 * versions); fall back to the spread copy when it's missing.
 *
 * The recharts event arg is typed as `any` internally — this helper narrows
 * to the data shape the caller knows.
 */
export function getRechartsPayload<T>(e: unknown): T | null {
  if (e == null) return null;
  const fromPayload = (e as { payload?: unknown }).payload;
  if (fromPayload != null) return fromPayload as T;
  // No `.payload` — the arg itself carries the spread data fields.
  return e as T;
}
