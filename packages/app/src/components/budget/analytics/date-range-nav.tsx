import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DateRange } from "@capybudget/core";
import type { PeriodType } from "@/stores/analytics-store";

interface DateRangeNavProps {
  periodType: PeriodType;
  dateRange: DateRange;
  allowedPeriods: PeriodType[];
  onPeriodChange: (type: PeriodType) => void;
  onBack: () => void;
  onForward: () => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PERIOD_LABELS: Record<PeriodType, string> = {
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  allTime: "All Time",
  custom: "Custom Range",
};

function formatRangeLabel(range: DateRange, periodType: PeriodType): string {
  if (periodType === "allTime") return "All Time";

  const start = range.start;
  const endDate = new Date(range.end);
  endDate.setDate(endDate.getDate() - 1);

  if (periodType === "month") {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }

  if (periodType === "quarter") {
    const q = Math.floor(start.getMonth() / 3) + 1;
    return `Q${q} ${start.getFullYear()}`;
  }

  if (periodType === "year") {
    return `${start.getFullYear()}`;
  }

  // custom
  const startMonth = start.getMonth();
  const startYear = start.getFullYear();
  const endMonth = endDate.getMonth();
  const endYear = endDate.getFullYear();

  if (startMonth === endMonth && startYear === endYear) {
    return `${MONTH_NAMES[startMonth]} ${startYear}`;
  }

  if (startYear === endYear) {
    return `${SHORT_MONTHS[startMonth]} \u2013 ${SHORT_MONTHS[endMonth]} ${startYear}`;
  }

  return `${SHORT_MONTHS[startMonth]} ${startYear} \u2013 ${SHORT_MONTHS[endMonth]} ${endYear}`;
}

export function DateRangeNav({
  periodType,
  dateRange,
  allowedPeriods,
  onPeriodChange,
  onBack,
  onForward,
}: DateRangeNavProps) {
  const label = formatRangeLabel(dateRange, periodType);
  const canNavigate = periodType !== "allTime";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={!canNavigate}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold min-w-[160px] text-center">
          {label}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onForward}
          disabled={!canNavigate}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5" />
          }
        >
          {PERIOD_LABELS[periodType]}
          <ChevronRight className="h-3 w-3 rotate-90" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allowedPeriods.map((type) => (
            <DropdownMenuItem
              key={type}
              onClick={() => onPeriodChange(type)}
            >
              {PERIOD_LABELS[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
