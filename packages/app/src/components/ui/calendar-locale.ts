import { enUS, enGB, es, ru, type Locale } from "react-day-picker/locale"

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

// Intl week info isn't in TS's ES2023 lib yet; type what we read (firstDay is 1=Mon … 7=Sun).
type IntlWeekInfo = { firstDay: number }
type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => IntlWeekInfo
  weekInfo?: IntlWeekInfo
}

export type CalendarLocale = {
  locale: Locale
  weekStartsOn: WeekStart
}

function nameLocaleFor(formatTag: string): Locale {
  const [language, region] = formatTag.toLowerCase().split("-")
  switch (language) {
    case "en":
      return region === "gb" ? enGB : enUS
    case "es":
      return es
    case "ru":
      return ru
    default:
      return enUS
  }
}

/**
 * Intl reports `firstDay` as 1=Mon … 7=Sun; date-fns wants 0=Sun … 6=Sat.
 * `% 7` folds Intl's 7 (Sunday) to 0 and leaves Mon–Sat (1–6) unchanged.
 */
function weekStartFromRegion(formatTag: string, fallback: Locale): WeekStart {
  try {
    const locale = new Intl.Locale(formatTag) as LocaleWithWeekInfo
    const weekInfo =
      typeof locale.getWeekInfo === "function"
        ? locale.getWeekInfo()
        : locale.weekInfo
    if (weekInfo) {
      return (weekInfo.firstDay % 7) as WeekStart
    }
  } catch {
    // Intl week info unavailable on this engine — fall through to the default.
  }
  return (fallback.options?.weekStartsOn ?? 0) as WeekStart
}

export function resolveCalendarLocale(formatTag: string): CalendarLocale {
  const locale = nameLocaleFor(formatTag)
  return { locale, weekStartsOn: weekStartFromRegion(formatTag, locale) }
}
