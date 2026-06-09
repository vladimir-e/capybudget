/**
 * Locating the real header row in a parsed CSV grid.
 *
 * Bank exports often prepend a summary preamble (balance totals, account info)
 * before the transaction table, so parsing with line 1 as the header locks
 * onto the preamble and leaves the real columns unaddressable. These helpers
 * operate on the raw `header: false` grid (array-of-array rows, blank lines
 * stripped): find the most plausible header row, and build header-keyed row
 * objects whose keys are always non-empty and unique.
 */

/** How many leading rows are scanned as header candidates — and how many the
 *  mapping prompt lists with indices, so the detector and a model-supplied
 *  `headerRow` override always refer to the same window. */
export const HEADER_SCAN_ROWS = 25;

/** A CSV table anchored at a chosen header row: trimmed, addressable header
 *  keys plus the data rows below keyed by them. */
export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * The row whose field count the following rows sustain the longest. Each
 * candidate in the first {@link HEADER_SCAN_ROWS} rows is scored over its run
 * of consecutive following rows matching its width; the max wins, ties going
 * to the earliest. A narrow summary preamble loses to the real header backed
 * by the whole table; a uniform-width file picks row 0.
 */
export function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const score = headerScore(rows, i);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** Whether `index` names a row that can head a table: an integer in range with
 *  at least one following row matching its field count. The sanity check a
 *  model-supplied `headerRow` must pass before it overrides the detected one. */
export function isViableHeaderRow(rows: string[][], index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return false;
  return headerScore(rows, index) > 0;
}

/**
 * Header-keyed row objects from the grid: `headerIndex` is the header, every
 * row after it is data. Header cells are trimmed; a blank cell is named
 * positionally (`Column 2`) and a duplicate gets a numeric suffix
 * (`Description 2`), so every column a mapping might reference has a non-empty
 * unique key. Data cells beyond the header's width are dropped; missing ones
 * read as `""`.
 */
export function buildCsvTable(rows: string[][], headerIndex: number): CsvTable {
  const headers = uniqueHeaderKeys(rows[headerIndex] ?? []);
  const dataRows = rows
    .slice(headerIndex + 1)
    .map((cells) => Object.fromEntries(headers.map((key, i) => [key, cells[i] ?? ""])));
  return { headers, rows: dataRows };
}

/** Each matching-width follower scores 1, or 2 when it carries a whole-field
 *  date — transaction-shaped rows outweigh an equally-wide summary preamble,
 *  which matters on a statement with only a handful of transactions. */
function headerScore(rows: string[][], index: number): number {
  const width = rows[index].length;
  let score = 0;
  for (let i = index + 1; i < rows.length && rows[i].length === width; i++) {
    score += rows[i].some(isDateLike) ? 2 : 1;
  }
  return score;
}

function isDateLike(value: string): boolean {
  const v = value.trim().split(/[T ]/)[0];
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(v);
}

function uniqueHeaderKeys(cells: string[]): string[] {
  const used = new Set<string>();
  return cells.map((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base} ${n}`;
    used.add(key);
    return key;
  });
}
