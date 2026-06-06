/**
 * The Smart Import run pipeline — the ordered phase descriptor for the
 * single-session run. See INTELLIGENCE.md § Import Sessions.
 *
 * Adding a phase is adding one ordered {@link IMPORT_PIPELINE} entry. Order
 * matters: account mapping must precede dedup because dedup's matching rules
 * key off the resolved account.
 */

import type { ImportPhase } from "@capybudget/core"
import { ACCOUNTS_INSTRUCTION } from "../prompts/accounts"
import { DEDUP_INSTRUCTION } from "../prompts/dedup"
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
  {
    phase: "accounts",
    // `apply_account_aliases` is the deterministic pre-step — it sets
    // `accountId` from stored `.capy/aliases.json` maps (the authoritative
    // top precedence layer). The agent turn then maps the remaining unmapped
    // source accounts via `enrich_update` (which only fills empties), so
    // aliases always win. Code-triggered: not advertised, dispatched here.
    preStepTools: ["apply_account_aliases"],
    instruction: ACCOUNTS_INSTRUCTION,
  },
  {
    phase: "dedup",
    // `auto_mark_duplicates` is the deterministic pre-step — it runs the finder
    // (`detectDuplicates`) and auto-marks every HIGH-confidence (exact) match,
    // dup-enriching each. The agent turn then reviews the remaining
    // LOW-confidence candidates via `find_duplicates` and marks the genuine
    // ones with `mark_duplicates`. Order matters: accounts before dedup, since
    // dedup's matching rules key off the resolved account (now persisted).
    preStepTools: ["auto_mark_duplicates"],
    instruction: DEDUP_INSTRUCTION,
  },
  {
    phase: "enriching",
    // `auto_enrich` is the deterministic pre-enrich pass — it maps
    // sourceCategory → categories and resolves transfer targets, leaving
    // `merchant` and `categoryId` gaps for the model. (Account mapping is the
    // accounts phase's job, not this pass.) Code-triggered: not advertised,
    // dispatched here via runTool.
    preStepTools: ["auto_enrich"],
    instruction: ENRICH_INSTRUCTION,
  },
]
