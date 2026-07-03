// One-shot signal from the launch redirect to the budget selector: the last
// budget couldn't be reopened (folder moved/deleted, or sandbox access lapsed).
// Auto-open is turned off at the same time, so the selector shows a one-time
// notice — the budget's name and the path that wasn't there.

export interface ReopenFailure {
  path: string;
  name: string;
}

let pending: ReopenFailure | null = null;

export function flagReopenFailure(info: ReopenFailure): void {
  pending = info;
}

export function consumeReopenFailure(): ReopenFailure | null {
  const failure = pending;
  pending = null;
  return failure;
}
