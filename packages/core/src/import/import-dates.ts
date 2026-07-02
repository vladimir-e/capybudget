/**
 * Import date parsing, shared by the two consumers with different postures:
 * the CSV transform parses format-directed (`DATE_FORMATS[mapping.format]`,
 * errors surfaced per row), while `buildStaged` coerces format-sniffing
 * (`coerceIsoDate`, unparseable degrades to a fallback) — the image path has
 * no mapping to direct it and a bad model date must never poison staging.
 */

export const DATE_FORMATS: Record<string, (s: string) => string | null> = {
  "YYYY-MM-DD": (s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  },
  "MM/DD/YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[1])}-${pad2(m[2])}` : null;
  },
  "DD/MM/YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
  },
  "DD.MM.YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
  },
  "MM-DD-YYYY": (s) => {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[1])}-${pad2(m[2])}` : null;
  },
  "YYYY/MM/DD": (s) => {
    const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  },
};

/** The date-format patterns the import pipeline can parse — the canonical
 *  vocabulary a model-supplied `date.format` must be constrained to. */
export const SUPPORTED_DATE_FORMATS: readonly string[] = Object.keys(DATE_FORMATS);

function pad2(s: string): string {
  return s.length === 1 ? `0${s}` : s;
}

/** Whether an already-shaped `YYYY-MM-DD` string names a real calendar date
 *  (rejects the likes of `2026-02-30`). */
export function isCalendarDate(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Sniff a date in any supported format into `YYYY-MM-DD`, or `null` when
 * nothing parses. A time portion is stripped first.
 * Formats are tried in `DATE_FORMATS` declaration order, so an
 * ambiguous slash date reads US `MM/DD/YYYY`; a first component over 12 fails
 * the calendar check and falls through to `DD/MM/YYYY`.
 */
export function coerceIsoDate(value: string): string | null {
  const dateOnly = value.trim().split(/[T ]/)[0];
  for (const parse of Object.values(DATE_FORMATS)) {
    const iso = parse(dateOnly);
    if (iso && isCalendarDate(iso)) return iso;
  }
  return null;
}
