import type { ParseKeys } from "i18next"

// `ParseKeys<Ns>` is the namespace's union of valid (unprefixed) `t()` keys.
// Typing a map `satisfies Record<Enum, NsKey>` makes the compiler enforce both
// exhaustiveness (every member mapped) and key validity at the map literal.
export type BudgetKey = ParseKeys<"budget">
export type AnalyticsKey = ParseKeys<"analytics">
export type SettingsKey = ParseKeys<"settings">
export type CapyKey = ParseKeys<"capy">
export type DemoKey = ParseKeys<"demo">
