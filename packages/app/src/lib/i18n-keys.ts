import type { ParseKeys } from "i18next"

/**
 * Per-namespace catalog-key types, the default for any enum→key lookup.
 *
 * `ParseKeys<Ns>` is i18next's own union of every valid key for a namespace,
 * derived from the `en` catalogs — unprefixed, matching what `t()` takes when
 * called with that namespace as primary (`useTranslation("budget")`). Typing a
 * key map as `Record<Enum, BudgetKey>` (etc.) makes the compiler guarantee, at
 * the map literal, that every enum member is present (exhaustiveness) and that
 * each value resolves to a real key (validity) — which is why the runtime
 * lockstep tests these maps replaced are no longer needed. Reach for this when a
 * lookup needs that guarantee: an enum or core-derived name set where coverage
 * must be proven. A dynamic `t(\`foo.${id}\`)` over a local constant array or
 * small closed union (tab ids, toggle options) stays fine — the id set is right
 * there, so a map would add indirection without buying drift-safety.
 */
export type BudgetKey = ParseKeys<"budget">
export type AnalyticsKey = ParseKeys<"analytics">
export type SettingsKey = ParseKeys<"settings">
export type CapyKey = ParseKeys<"capy">
export type DemoKey = ParseKeys<"demo">
