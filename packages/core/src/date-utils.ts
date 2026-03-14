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

/** Format YYYY-MM-DD as "Mar 10, 2026". */
export function formatDateLabel(s: string): string {
  return parseLocalDate(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Local ISO-ish datetime string (no timezone offset), e.g. "2026-03-10T14:30:05.123". */
export function localDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
