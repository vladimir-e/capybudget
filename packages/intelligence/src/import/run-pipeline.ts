/**
 * The Smart Import run pipeline — the ordered phase descriptor for the
 * single-session run. See INTELLIGENCE.md § Import Sessions.
 *
 * Adding a phase is adding one ordered {@link IMPORT_PIPELINE} entry. Order
 * matters: account mapping must precede dedup because dedup's matching rules
 * key off the resolved account.
 */

import type { ImportPhase } from "@capybudget/core"
import { ENRICH_INSTRUCTION } from "../prompts/enrich"

/** One ordered step in the import run. */
export interface ImportPhaseStep {
  /** Phase-machine state this step drives. */
  readonly phase: ImportPhase
  /**
   * Deterministic tool calls (by name) the orchestrator dispatches via
   * `runTool` *before* injecting the phase's instruction. Code-triggered —
   * these tools are not advertised to the model. Run in array order.
   */
  readonly preStepTools: readonly string[]
  /**
   * User-turn text injected into the session to start this phase.
   * `null` for the kickoff phase (normalize), whose instruction is the
   * import system prompt plus the screen-built initial message.
   */
  readonly instruction: string | null
}

export const IMPORT_PIPELINE: readonly ImportPhaseStep[] = [
  {
    phase: "normalizing",
    preStepTools: [],
    instruction: null,
  },
  // Unit 4 inserts an `accounts` step here (agent maps source accounts →
  // Capy accounts), and Unit 2 inserts a `dedup` step after it (deterministic
  // find + agent adjudication). Order matters: accounts before dedup.
  {
    phase: "enriching",
    // `auto_enrich` is the deterministic pre-enrich pass — it fuzzy-maps
    // sourceCategory → categories, sourceAccount → accounts, and resolves
    // transfer targets, leaving `merchant` for the model. Code-triggered:
    // not advertised, dispatched here via runTool.
    preStepTools: ["auto_enrich"],
    instruction: ENRICH_INSTRUCTION,
  },
]
