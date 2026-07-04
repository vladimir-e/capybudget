/**
 * OFX-family → staged rows. The third Normalizing path, beside `normalizeCsv`
 * and `normalizeImage` — but fully deterministic: OFX fields are standardized,
 * so there is no model round-trip. `ofx-js` parses the SGML/XML tree; this maps
 * that tree onto the same intermediate `StagedRecord`s the other two paths
 * produce, fed through the same `buildStaged`. After Normalizing no phase knows
 * a row came from OFX.
 *
 * Handles both the credit-card (`CCSTMTRS`) and bank (`STMTRS`) statement
 * shapes, single or repeated, in OFX 1.x SGML or OFX 2.x XML — `ofx-js`
 * normalizes those into one typed tree.
 */

import { parseStrict, type ofxTypes } from "ofx-js"
import {
  buildStaged,
  parseCurrencyToCents,
  type ImportTransaction,
  type StagedRecord,
} from "@capybudget/core"
import { accountFromFilename } from "./normalize"

export interface NormalizeOfxResult {
  /** Empty when the file parsed to no transactions or couldn't be parsed — the
   *  orchestrator routes an all-empty run to the recoverable `no_data` state. */
  rows: ImportTransaction[]
  /** One note per transaction skipped for an unparseable field — surfaced by the
   *  orchestrator as a warn line, the same way the CSV path reports skips. */
  dropped: string[]
}

/**
 * Parse an OFX-family file and emit staged rows. Never throws: a malformed file
 * yields no rows (the orchestrator treats that as `no_data`), so one bad export
 * can't crash a multi-file run.
 */
export function normalizeOfx(
  source: { name: string; content: string },
  options: { startId?: number } = {},
): NormalizeOfxResult {
  const { records, dropped } = parseOfxRecords(source.content, source.name)
  return { rows: buildStaged(records, { startId: options.startId }), dropped }
}

interface StatementGroup {
  transactions: ofxTypes.StatementTransaction[]
  acctId: string | undefined
  /** Payments on a credit-card statement are card-payoff transfers, not income;
   *  bank statements have no such rule. */
  isCreditCard: boolean
}

function parseOfxRecords(
  content: string,
  filename: string,
): { records: StagedRecord[]; dropped: string[] } {
  let doc: ofxTypes.ParsedOFX
  try {
    doc = parseStrict(content)
  } catch {
    return { records: [], dropped: [] }
  }
  const ofx = doc.OFX
  // FI organization name ("Apple Card", "Chase") is the human-facing account
  // hint that grounding can match against an existing budget account by name —
  // ACCTID is frequently an opaque id (Apple Card's is a UUID). Fall back to the
  // filename, the same heal the CSV/image paths apply to an empty account.
  const org = ofx?.SIGNONMSGSRSV1?.SONRS?.FI?.ORG?.trim()
  const base = org || accountFromFilename(filename)
  const groups = collectStatements(ofx)
  // A file with more than one statement is more than one account; a single
  // source-account name would merge them. Disambiguate by the account-id tail.
  const multiAccount = groups.length > 1

  const records: StagedRecord[] = []
  const dropped: string[] = []
  groups.forEach((group, i) => {
    const sourceAccount = multiAccount ? accountLabel(base, group.acctId, i) : base
    for (const txn of group.transactions) {
      const amount = amountToCents(txn.TRNAMT)
      if (amount === null) {
        dropped.push(`${describeTxn(txn)}: unparseable amount ${JSON.stringify(txn.TRNAMT ?? "")}`)
        continue
      }
      records.push({
        date: ofxDateToIso(txn.DTPOSTED),
        amount,
        type: classifyType(txn.TRNTYPE, amount, group.isCreditCard),
        description: buildDescription(txn.NAME ?? txn.PAYEE?.NAME, txn.MEMO),
        sourceAccount,
        sourceCategory: "",
      })
    }
  })
  return { records, dropped }
}

function collectStatements(ofx: ofxTypes.ParsedOFX["OFX"]): StatementGroup[] {
  const groups: StatementGroup[] = []
  for (const trnrs of toArray(ofx?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS)) {
    groups.push({
      transactions: toArray(trnrs?.CCSTMTRS?.BANKTRANLIST?.STMTTRN),
      acctId: trnrs?.CCSTMTRS?.CCACCTFROM?.ACCTID,
      isCreditCard: true,
    })
  }
  for (const trnrs of toArray(ofx?.BANKMSGSRSV1?.STMTTRNRS)) {
    groups.push({
      transactions: toArray(trnrs?.STMTRS?.BANKTRANLIST?.STMTTRN),
      acctId: trnrs?.STMTRS?.BANKACCTFROM?.ACCTID,
      isCreditCard: false,
    })
  }
  return groups
}

/** `base` plus the account-id's last 4 alphanumerics ("Apple Card 3bf5"), or a
 *  1-based index when the id yields nothing — enough to keep two statements in
 *  one file from collapsing into a single source account. */
function accountLabel(base: string, acctId: string | undefined, index: number): string {
  const tail = (acctId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-4)
  return tail ? `${base} ${tail}` : `${base} ${index + 1}`
}

/** OFX `TRNAMT` is a signed decimal already in capy's sign convention (negative
 *  = outflow). Usually a dot decimal (`-9.99`), but the spec permits a comma
 *  decimal (`-9,99`) with no thousands grouping — route that to the european
 *  parser so it isn't read as `-999`. A dot decimal with comma thousands
 *  (`-1,234.56`) stays plain. Reuses the CSV path's parser so cents round
 *  identically. */
function amountToCents(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null
  const trimmed = raw.trim()
  const format = /^-?\d+,\d{1,2}$/.test(trimmed) ? "european" : "plain"
  try {
    return parseCurrencyToCents(trimmed, format, 0)
  } catch {
    return null
  }
}

/** `20260704120000[0:GMT]` → `2026-07-04`. The zone suffix and time are
 *  dropped; a shape that doesn't match passes through for `buildStaged`'s
 *  coercion (which falls back to today). */
function ofxDateToIso(raw: string | undefined): string {
  const m = /^\s*(\d{4})(\d{2})(\d{2})/.exec(raw ?? "")
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (raw ?? "")
}

/**
 * `XFER` is a transfer on any account; `PAYMENT` on a credit card is a card
 * payoff (a transfer leg), whereas on a bank account it's an outgoing bill
 * payment (an expense). Everything else is typed by amount sign — a zero amount
 * reads as an expense, matching the CSV path — and grounding's payment-leg
 * recognition and the classifier take it from there, exactly as for a CSV row
 * the mapper didn't flag.
 */
function classifyType(
  trntype: string | undefined,
  amount: number,
  isCreditCard: boolean,
): StagedRecord["type"] {
  const t = (trntype ?? "").toUpperCase()
  if (t === "XFER") return "transfer"
  if (isCreditCard && t === "PAYMENT") return "transfer"
  return amount > 0 ? "income" : "expense"
}

function buildDescription(name: string | undefined, memo: string | undefined): string {
  const n = (name ?? "").trim()
  const m = (memo ?? "").trim()
  if (n && m && n.toLowerCase() !== m.toLowerCase()) return `${n} ${m}`
  return n || m
}

function describeTxn(txn: ofxTypes.StatementTransaction): string {
  const id = txn.FITID?.trim()
  return id ? `Transaction ${id}` : "Transaction"
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}
