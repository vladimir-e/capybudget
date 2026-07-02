// One-shot signal from the launch redirect to the budget selector: the last
// budget couldn't be reopened (folder moved/deleted, or sandbox access lapsed),
// so the selector shows an explanatory prompt instead of a bare screen.

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
