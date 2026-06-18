import { ChevronDown } from "lucide-react";
import { BUDGET_BASES, BASIS_OPTION_LABELS } from "@capybudget/core";
import type { BudgetBasis } from "@capybudget/core";
import { useFormatMoney } from "@/contexts/currency-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/** Default reference-pin label when no resolved basis label is threaded
 *  (direct `BudgetBar` renders, tests). In the tab, the live label comes from
 *  `basisLabel(basis, viewedMonth)` and is passed down explicitly. */
const DEFAULT_REFERENCE_LABEL = "3-mo avg";

/** Pin display label. `lastMonth` is fixed; the reference pin shows whatever
 *  basis label is in effect ("6-mo avg", "Dec 2024", …). */
function pinLabel(kind: BarPin["kind"], referenceLabel: string): string {
  return kind === "lastMonth" ? "Last month" : referenceLabel;
}

function pct(fraction: number): string {
  // Round to 2 dp to avoid float dust (e.g. 49.99999%) without trailing zeros.
  return `${Math.round(fraction * 10000) / 100}%`;
}

/** The pin diamond on its own — a rotated square, filled for `lastMonth`,
 *  hollow (page-colored center) for `reference`. Shared by the bar's pins and
 *  the legend so the two can never drift apart. */
function PinGlyph({ kind }: { kind: BarPin["kind"] }) {
  const solid = kind === "lastMonth";
  return (
    <span
      className="block h-1.5 w-1.5 rotate-45 border"
      style={{
        borderColor: "var(--muted-foreground)",
        backgroundColor: solid ? "var(--muted-foreground)" : "var(--background)",
      }}
    />
  );
}

/** The divider line on its own — dashed/ghosted when auto-derived, solid and
 *  strong when user-set. Shared by the bar's divider and the legend. */
function DividerGlyph({ isImplicit }: { isImplicit: boolean }) {
  return (
    <span
      className="block h-full mx-auto"
      style={{
        borderLeftWidth: isImplicit ? "1.5px" : "2px",
        borderLeftStyle: isImplicit ? "dashed" : "solid",
        borderLeftColor: isImplicit ? "var(--muted-foreground)" : "var(--foreground)",
        opacity: isImplicit ? 0.7 : 0.9,
      }}
    />
  );
}

/** A reference marker sitting above the bar. Keyboard-focusable with a
 *  descriptive label; hover/focus reveals the exact value. */
function Pin({ pin, referenceLabel }: { pin: BarPin; referenceLabel: string }) {
  const { format } = useFormatMoney();
  const label = `${pinLabel(pin.kind, referenceLabel)}: ${format(pin.value)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="absolute top-0 -translate-x-1/2 flex h-2.5 w-3 items-start justify-center cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:rounded-sm"
            style={{ left: pct(pin.fraction) }}
            aria-label={label}
          />
        }
      >
        <PinGlyph kind={pin.kind} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
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
  const { format } = useFormatMoney();
  const label = isImplicit
    ? `Auto target: ${format(target)}`
    : `Budget: ${format(target)}`;
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
        <DividerGlyph isImplicit={isImplicit} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The zoned budget bar: a green zone (0 → target) and a red over-zone
 *  (target → over-max) with a fixed divider fraction across every row, a
 *  solid spend fill that turns red once it crosses the divider, a last-month
 *  pin and a basis-driven reference pin above the track, and a divider styled by
 *  whether the target is user-set or auto-derived.
 *
 *  All geometry comes from `barGeometry`; this component only paints it. The
 *  reference pin's label reflects the active basis (defaulting to "3-mo avg"
 *  for direct renders that don't thread one). */
export function BudgetBar({
  row,
  referenceLabel = DEFAULT_REFERENCE_LABEL,
}: {
  row: BudgetRow;
  referenceLabel?: string;
}) {
  const { format } = useFormatMoney();
  const geo = barGeometry(row);
  const overLabel = geo.state === "over" ? " (over target)" : "";

  // Untargeted: no scale to draw against, so don't fake a fill (a full-width
  // bar for every untargeted row reads as a "wall of bars" and implies a level
  // that doesn't exist). Render a faint dashed track instead — calm, clearly
  // "awaiting a target", and quiet in bulk. The spend itself lives in the
  // Spent column; the bar only signals state here.
  if (geo.state === "untargeted") {
    return (
      <div
        className="h-2.5 rounded-full border border-dashed border-muted-foreground/25"
        role="img"
        aria-label="No target yet — Capy needs spending history to set one"
      />
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
              <Pin key={p.kind} pin={p} referenceLabel={referenceLabel} />
            ))}
          </div>
        </div>
      )}

      {/* Zoned track. */}
      <div
        className="relative h-2.5 rounded-full overflow-hidden"
        role="img"
        aria-label={`Spent ${format(row.spent)} of ${format(
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

function LegendItem({ glyph, label }: { glyph: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="inline-flex h-3 w-4 items-center justify-center">{glyph}</span>
      <span>{label}</span>
    </span>
  );
}

/** A compact key for the two history pins that float above each bar — a filled
 *  diamond for last month, a hollow one for the reference average. The zones,
 *  divider, and fill are visually self-evident and don't earn a legend row.
 *  Right-aligned so it sits near where the pins actually render. Renders the
 *  same `PinGlyph` as the bars themselves, so the two can't drift apart.
 *
 *  The reference item doubles as the basis picker: its label is the resolved
 *  reference (`referenceLabel`), and clicking it opens a menu of the four
 *  comparison bases. The filled last-month item stays static. */
export function BudgetBarLegend({
  basis,
  referenceLabel,
  onBasisChange,
}: {
  basis: BudgetBasis;
  referenceLabel: string;
  onBasisChange: (basis: BudgetBasis) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <LegendItem glyph={<PinGlyph kind="lastMonth" />} label="last month" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
              aria-label={`Comparison basis: ${referenceLabel}`}
            />
          }
        >
          <span className="inline-flex h-3 w-4 items-center justify-center">
            <PinGlyph kind="reference" />
          </span>
          <span>{referenceLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={basis}
            onValueChange={(v) => onBasisChange(v as BudgetBasis)}
          >
            {BUDGET_BASES.map((b) => (
              <DropdownMenuRadioItem key={b} value={b}>
                {BASIS_OPTION_LABELS[b]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
