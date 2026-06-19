/** Format a Date as YYYY-MM-DD (local time). */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD. */
export function getToday(): string {
  return toDateString(new Date());
}

/** Parse YYYY-MM-DD into a Date at noon local (avoids timezone-shift edge cases). */
export function parseLocalDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

// Wording of the rendered date follows this locale; callers thread in the
// active UI language. Defaults to the source locale so existing callers keep
// rendering English.
const SOURCE_LOCALE = "en-US";

/** Format YYYY-MM-DD as "Mar 10, 2026" (locale-dependent wording). */
export function formatDateLabel(s: string, locale: string = SOURCE_LOCALE): string {
  return parseLocalDate(s).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format YYYY-MM-DD as a localized "March 2026" month-and-year label. */
export function formatMonthLabel(s: string, locale: string = SOURCE_LOCALE): string {
  return parseLocalDate(s).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

/** Local ISO-ish datetime string (no timezone offset), e.g. "2026-03-10T14:30:05.123". */
export function localDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
