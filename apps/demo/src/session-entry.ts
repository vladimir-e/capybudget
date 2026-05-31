// Tracks whether the visitor reached a scenario via the in-app selector this
// session. Module-scoped and deliberately NOT persisted — a full page load
// re-evaluates the module, resetting the flag to false. That reset is the
// mechanism: a hard refresh or deep link always lands on scenario selection
// rather than dropping into a freshly-regenerated budget.

let enteredScenario = false;

export function markScenarioEntered(): void {
  enteredScenario = true;
}

export function hasEnteredScenario(): boolean {
  return enteredScenario;
}
