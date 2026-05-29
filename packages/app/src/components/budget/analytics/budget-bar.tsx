import { formatMoney } from "@capybudget/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BudgetRow } from "./monthly-budget-rows";
import { barGeometry, type BarPin } from "./budget-bar-geometry";

// ── Zone + fill colors ────
//
// Derived from the stable semantic amount tokens (income-green / expense-red)
// so the bar tracks the same palette as money everywhere else. The zone
// backgrounds are heavily mixed toward transparent so they read as tinted
// regions behind a solid fill; the fill uses the tokens at full strength.
const ZONE_GREEN = "color-mix(in oklch, var(--amount-income) 14%, transparent)";
const ZONE_RED = "color-mix(in oklch, var(--amount-expense) 14%, transparent)";
const FILL_GREEN = "var(--amount-income)";
const FILL_RED = "var(--amount-expense)";

const PIN_LABEL: Record<BarPin["kind"], string> = {
  lastMonth: "Last month",
  avg3Month: "3-mo avg",
};

function pct(fraction: number): string {
  // Round to 2 dp to avoid float dust (e.g. 49.99999%) without trailing zeros.
  return `${Math.round(fraction * 10000) / 100}%`;
}

/** A reference marker sitting above the bar, rendered as a small rotated
 *  square (diamond). `lastMonth` is filled solid, `avg3Month` is hollow
 *  (outlined, page-colored center) — so the two read apart by shape-fill, not
 *  color or position alone. Keyboard-focusable with a descriptive label;
 *  hover/focus reveals the exact value. */
function Pin({ pin }: { pin: BarPin }) {
  const solid = pin.kind === "lastMonth";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="absolute top-0 -translate-x-1/2 flex h-2.5 w-3 items-start justify-center cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:rounded-sm"
            style={{ left: pct(pin.fraction) }}
            aria-label={`${PIN_LABEL[pin.kind]}: ${formatMoney(pin.value)}`}
          />
        }
      >
        <span
          className="block h-1.5 w-1.5 rotate-45 border"
          style={{
            borderColor: "var(--muted-foreground)",
            backgroundColor: solid ? "var(--muted-foreground)" : "var(--background)",
          }}
        />
      </TooltipTrigger>
      <TooltipContent>
        {PIN_LABEL[pin.kind]}: {formatMoney(pin.value)}
      </TooltipContent>
    </Tooltip>
  );
}

/** The target divider. Explicit (user-set) targets get a solid, strong line;
 *  implicit (auto-derived) targets get a dashed, ghosted line — so the user
 *  can tell at a glance which targets they own vs which Capy inferred. */
function Divider({
  fraction,
  isImplicit,
  target,
}: {
  fraction: number;
  isImplicit: boolean;
  target: number;
}) {
  const label = isImplicit
    ? `Auto target: ${formatMoney(target)}`
    : `Budget: ${formatMoney(target)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="absolute -top-0.5 -bottom-0.5 -translate-x-1/2 w-2 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:rounded-sm"
            style={{ left: pct(fraction) }}
            aria-label={label}
          />
        }
      >
        <span
          className="block h-full mx-auto"
          style={{
            borderLeftWidth: isImplicit ? "1.5px" : "2px",
            borderLeftStyle: isImplicit ? "dashed" : "solid",
            borderLeftColor: isImplicit
              ? "var(--muted-foreground)"
              : "var(--foreground)",
            opacity: isImplicit ? 0.7 : 0.9,
          }}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The zoned budget bar: a green zone (0 → target) and a red over-zone
 *  (target → over-max) with a fixed divider fraction across every row, a
 *  solid spend fill that turns red once it crosses the divider, reference
 *  pins for last-month / 3-mo-avg above the track, and a divider styled by
 *  whether the target is user-set or auto-derived.
 *
 *  All geometry comes from `barGeometry`; this component only paints it. */
export function BudgetBar({ row }: { row: BudgetRow }) {
  const geo = barGeometry(row);
  const overLabel = geo.state === "over" ? " (over target)" : "";

  // Untargeted: no zones, divider, or pins — a calm muted bar that only
  // conveys that money was (or wasn't) spent, since there's nothing to be
  // measured against.
  if (geo.state === "untargeted") {
    return (
      <div
        className="relative h-2.5 rounded-full bg-muted overflow-hidden"
        role="img"
        aria-label="No target — spending shown without a budget to measure against"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: pct(geo.fillFraction),
            backgroundColor: "var(--muted-foreground)",
            opacity: 0.45,
          }}
        />
      </div>
    );
  }

  const fillColor = geo.state === "over" ? FILL_RED : FILL_GREEN;

  return (
    // A little headroom above the track for the pins to sit in.
    <div className="relative pt-2">
      {/* Pins float above the bar on the shared scale. */}
      {geo.pins.length > 0 && (
        <div className="absolute inset-x-0 top-0 h-2 pointer-events-none">
          <div className="relative h-full pointer-events-auto">
            {geo.pins.map((p) => (
              <Pin key={p.kind} pin={p} />
            ))}
          </div>
        </div>
      )}

      {/* Zoned track. */}
      <div
        className="relative h-2.5 rounded-full overflow-hidden"
        role="img"
        aria-label={`Spent ${formatMoney(row.spent)} of ${formatMoney(
          row.effectiveTarget ?? 0,
        )} target${overLabel}`}
      >
        {/* Green zone (0 → divider). */}
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: pct(geo.targetFraction ?? 0), backgroundColor: ZONE_GREEN }}
        />
        {/* Red over-zone (divider → end). */}
        <div
          className="absolute inset-y-0 right-0"
          style={{
            left: pct(geo.targetFraction ?? 0),
            backgroundColor: ZONE_RED,
          }}
        />
        {/* Spend fill. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: pct(geo.fillFraction), backgroundColor: fillColor }}
        />
      </div>

      {/* Divider overlays the track so it stays visible through the fill.
       *  Omitted at fraction 0 (explicit-zero target) — a line on the left
       *  edge reads as chrome, and the all-red fill already says "over". */}
      {geo.targetFraction !== null && geo.targetFraction > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-2.5 pointer-events-none">
          <div className="relative h-full pointer-events-auto">
            <Divider
              fraction={geo.targetFraction}
              isImplicit={geo.isImplicit}
              target={row.effectiveTarget ?? 0}
            />
          </div>
        </div>
      )}
    </div>
  );
}
