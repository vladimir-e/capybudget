import { useState } from "react";
import { subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "@capybudget/core";
import type { PeriodType } from "@/stores/analytics-store";
import type { DateRange as CalendarDateRange } from "react-day-picker";
import { formatRangeLabel } from "./format-range";

interface DateRangeNavProps {
  periodType: PeriodType;
  dateRange: DateRange;
  allowedPeriods: PeriodType[];
  onPeriodChange: (type: PeriodType) => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onCustomRange: (range: DateRange) => void;
}

const PERIOD_LABELS: Record<PeriodType, string> = {
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  allTime: "All Time",
  custom: "Custom",
};

export function DateRangeNav({
  periodType,
  dateRange,
  allowedPeriods,
  onPeriodChange,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onCustomRange,
}: DateRangeNavProps) {
  const label = formatRangeLabel(dateRange, periodType);
  const showArrows = periodType !== "allTime";
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Always reflect the actual store state (already snapped to month boundaries)
  const endInclusive = new Date(dateRange.end);
  endInclusive.setDate(endInclusive.getDate() - 1);
  const [calendarRange, setCalendarRange] = useState<CalendarDateRange | undefined>(
    { from: dateRange.start, to: endInclusive },
  );

  function handlePillClick(type: PeriodType) {
    if (type === "custom") {
      const end = new Date(dateRange.end);
      end.setDate(end.getDate() - 1);
      setCalendarRange({ from: dateRange.start, to: end });
      setCalendarOpen(true);
    } else {
      onPeriodChange(type);
    }
  }

  function handleCalendarApply() {
    if (calendarRange?.from && calendarRange?.to) {
      // Snap to month boundaries — charts operate at month granularity
      const start = new Date(calendarRange.from.getFullYear(), calendarRange.from.getMonth(), 1);
      const end = new Date(calendarRange.to.getFullYear(), calendarRange.to.getMonth() + 1, 1);
      onCustomRange({ start, end });
      setCalendarOpen(false);
    }
  }

  return (
    <div className="flex items-center justify-between">
      {/* Left: arrows + label */}
      <div className="flex items-center gap-2">
        {showArrows && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <h2 className="text-lg font-semibold min-w-[160px] text-center">
          {label}
        </h2>
        {showArrows && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onForward}
            disabled={!canGoForward}
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Right: period pills. Always rendered — even when only one period is
       *  allowed (e.g. Monthly Budget) — so every tab's date row has the same
       *  shape. In the single-pill case the lone pill always shows as active
       *  and clicking it is a no-op since it's already selected. */}
      <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
        {allowedPeriods.filter((t) => t !== "custom").map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handlePillClick(type)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              periodType === type
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {PERIOD_LABELS[type]}
          </button>
        ))}
        {allowedPeriods.includes("custom") && (
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    periodType === "custom"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                />
              }
            >
              {PERIOD_LABELS.custom}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={calendarRange}
                onSelect={setCalendarRange}
                numberOfMonths={2}
                defaultMonth={calendarRange?.from ?? subMonths(new Date(), 1)}
              />
              <div className="flex items-center justify-end border-t px-3 py-2">
                <Button
                  size="sm"
                  disabled={!calendarRange?.from || !calendarRange?.to}
                  onClick={handleCalendarApply}
                >
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
