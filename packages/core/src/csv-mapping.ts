/**
 * Structured CSV column mapping — produced by AI, consumed by the transform engine.
 *
 * The AI analyzes a small sample of the source CSV (header + ~20 rows) and outputs
 * a CsvMapping object. The transform engine then applies it to every row instantly,
 * replacing the previous approach of having AI process each row individually.
 */

// ── Amount handling ─────────────────────────────────────────────

/** Source uses a single signed column (positive/negative). */
export interface SingleAmountMapping {
  style: "single";
  /** Column name containing the amount (e.g. "Amount", "Transaction Amount"). */
  column: string;
  /**
   * How to interpret the sign:
   * - "negative_expense": negative values are expenses (most bank exports)
   * - "positive_expense": positive values are expenses (some credit card exports)
   */
  sign: "negative_expense" | "positive_expense";
}

/** Source uses two separate columns for outflow/inflow (e.g. YNAB, some bank exports). */
export interface SplitAmountMapping {
  style: "split";
  /** Column for expenses/outflows (e.g. "Outflow", "Debit"). */
  expenseColumn: string;
  /** Column for income/inflows (e.g. "Inflow", "Credit"). */
  incomeColumn: string;
}

export type AmountMapping = SingleAmountMapping | SplitAmountMapping;

// ── Amount format ───────────────────────────────────────────────

export interface AmountFormat {
  /**
   * How amounts are formatted in the source:
   * - "plain":    1234.56 or -1234.56
   * - "currency": $1,234.56 or ($1,234.56) or -$1,234.56
   * - "european": 1.234,56 (dot as thousands separator, comma as decimal)
   */
  format: "plain" | "currency" | "european";
}

// ── Type detection ──────────────────────────────────────────────

export interface TypeDetection {
  /**
   * How to determine the transaction type:
   * - "amount_sign": derive from the amount — expense if negative, income if positive
   * - "column":      read from a specific column
   * - "rules":       use amount sign as base, with pattern-based overrides for transfers
   */
  method: "amount_sign" | "column" | "rules";

  /** When method is "column": the column to read the type from. */
  typeColumn?: string;
  /** When method is "column": mapping from source values to our types. */
  typeMap?: Record<string, "expense" | "income" | "transfer">;

  /**
   * Patterns that identify transfers. Matched against the description column.
   * E.g. ["Transfer :", "^XFER "] — uses substring match (not regex).
   */
  transferPatterns?: string[];
}

// ── Skip rules ──────────────────────────────────────────────────

export interface SkipRule {
  /** Column to check. */
  column: string;
  /** If the column value contains this substring (case-insensitive), skip the row. */
  contains?: string;
  /** If the column value exactly equals this (case-insensitive), skip the row. */
  equals?: string;
}

// ── Column reference ────────────────────────────────────────────

/** Simple single-column reference. */
export interface SingleColumnRef {
  column: string;
}

/** Concatenate multiple columns with a separator. */
export interface MultiColumnRef {
  columns: string[];
  separator: string;
}

export type ColumnRef = SingleColumnRef | MultiColumnRef;

// ── Top-level mapping ───────────────────────────────────────────

export interface CsvMapping {
  /** Date column and its format string (e.g. "MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY"). */
  date: {
    column: string;
    format: string;
  };

  /** Which column(s) form the transaction description. */
  description: ColumnRef;

  /** How amounts are structured in the source. */
  amount: AmountMapping;

  /** How amounts are formatted (currency symbols, separators). */
  amountFormat: AmountFormat;

  /** How to determine expense/income/transfer. */
  typeDetection: TypeDetection;

  /** Source account — from a column, or a literal value (e.g. inferred from filename). */
  sourceAccount: { column: string } | { literal: string };

  /** Source category column, if the source has category data. Null if not available. */
  sourceCategory: ColumnRef | null;

  /** Memo column. Null if not available. */
  memo: ColumnRef | null;

  /**
   * Merchant/payee column. When the source has a clean payee field (e.g. YNAB),
   * map it here so the merchant is set during normalization — no AI needed.
   * Null if the source has cryptic descriptions that need AI cleanup.
   */
  merchant?: ColumnRef | null;

  /** Rows to skip based on column values. */
  skipRules?: SkipRule[];
}
