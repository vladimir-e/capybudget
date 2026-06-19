import { useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  startOfWeek,
  endOfWeek,
  subDays,
} from "date-fns";
import { useLocale, useTranslation } from "@capybudget/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

export interface DateRangeValue {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  value: DateRangeValue | null;
  onChange: (range: DateRangeValue | null) => void;
}

type PresetKey =
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "last30Days"
  | "last90Days"
  | "last365Days"
  | "thisYear";

interface Preset {
  key: PresetKey;
  range: () => DateRangeValue;
}

function buildPresets(): Preset[] {
  const today = new Date();
  return [
    {
      key: "thisWeek",
      range: () => ({
        from: startOfWeek(today, { weekStartsOn: 1 }),
        to: endOfWeek(today, { weekStartsOn: 1 }),
      }),
    },
    {
      key: "thisMonth",
      range: () => ({ from: startOfMonth(today), to: endOfMonth(today) }),
    },
    {
      key: "lastMonth",
      range: () => {
        const last = subMonths(today, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      },
    },
    {
      key: "last30Days",
      range: () => ({ from: subDays(today, 30), to: today }),
    },
    {
      key: "last90Days",
      range: () => ({ from: subDays(today, 90), to: today }),
    },
    {
      key: "last365Days",
      range: () => ({ from: subDays(today, 365), to: today }),
    },
    {
      key: "thisYear",
      range: () => ({ from: startOfYear(today), to: today }),
    },
  ];
}

function formatRange(range: DateRangeValue, locale: string): string {
  const from = range.from.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const to = range.to.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
  return `${from} – ${to}`;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const { t } = useTranslation("budget");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(
    value ? { from: value.from, to: value.to } : undefined,
  );
  const [mode, setMode] = useState<"presets" | "custom">("presets");

  const presets = buildPresets();

  const handlePreset = (preset: Preset) => {
    onChange(preset.range());
    setOpen(false);
    setMode("presets");
  };

  const handleCustomApply = () => {
    if (customRange?.from && customRange?.to) {
      onChange({ from: customRange.from, to: customRange.to });
      setOpen(false);
      setMode("presets");
    }
  };

  const handleClear = () => {
    onChange(null);
    setCustomRange(undefined);
  };

  const triggerLabel = value ? formatRange(value, locale) : t("dateRange.allTime");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setMode("presets");
      }}
    >
      <div className="flex items-center">
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-8 gap-1.5 font-normal text-muted-foreground ${value ? "rounded-r-none border-r-0 text-foreground" : ""}`}
            />
          }
        >
          <CalendarDays className="h-3.5 w-3.5" />
          <span className="text-sm">{triggerLabel}</span>
        </PopoverTrigger>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="flex h-8 items-center rounded-r-lg border border-input px-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label={t("dateRange.clearFilter")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="end">
        {mode === "presets" ? (
          <div className="flex flex-col p-1 min-w-44">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePreset(preset)}
                className="rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors"
              >
                {t(`dateRange.${preset.key}`)}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setCustomRange(value ? { from: value.from, to: value.to } : undefined);
                setMode("custom");
              }}
              className="rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors"
            >
              {t("dateRange.customRange")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col">
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={setCustomRange}
              numberOfMonths={2}
              defaultMonth={customRange?.from ?? subMonths(new Date(), 1)}
            />
            <div className="flex items-center justify-between border-t px-3 py-2">
              <button
                type="button"
                onClick={() => setMode("presets")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("dateRange.presets")}
              </button>
              <Button
                size="sm"
                disabled={!customRange?.from || !customRange?.to}
                onClick={handleCustomApply}
              >
                {t("dateRange.apply")}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
