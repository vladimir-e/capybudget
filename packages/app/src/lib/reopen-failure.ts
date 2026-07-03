// One-shot signal from the launch redirect to the budget selector: the last
// budget couldn't be reopened (folder moved/deleted, or sandbox access lapsed).
// Auto-open is turned off at the same time, so the selector just shows a
// one-time notice naming the budget — recovery is the recents list.

let pendingName: string | null = null;

export function flagReopenFailure(name: string): void {
  pendingName = name;
}

export function consumeReopenFailure(): string | null {
  const name = pendingName;
  pendingName = null;
  return name;
}
