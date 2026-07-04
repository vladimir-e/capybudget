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
  const records = parseOfxRecords(source.content, source.name)
  return { rows: buildStaged(records, { startId: options.startId }) }
}

interface StatementGroup {
  transactions: ofxTypes.StatementTransaction[]
  /** Payments on a credit-card statement are card-payoff transfers, not income;
   *  bank statements have no such rule. */
  isCreditCard: boolean
}

function parseOfxRecords(content: string, filename: string): StagedRecord[] {
  let doc: ofxTypes.ParsedOFX
  try {
    doc = parseStrict(content)
  } catch {
    return []
  }
  const ofx = doc.OFX
  // FI organization name ("Apple Card", "Chase") is the human-facing account
  // hint that grounding can match against an existing budget account by name —
  // ACCTID is frequently an opaque id (Apple Card's is a UUID). Fall back to the
  // filename, the same heal the CSV/image paths apply to an empty account.
  const org = ofx?.SIGNONMSGSRSV1?.SONRS?.FI?.ORG?.trim()
  const sourceAccount = org || accountFromFilename(filename)

  const records: StagedRecord[] = []
  for (const group of collectStatements(ofx)) {
    for (const txn of group.transactions) {
      const record = toRecord(txn, group.isCreditCard, sourceAccount)
      if (record) records.push(record)
    }
  }
  return records
}

function collectStatements(ofx: ofxTypes.ParsedOFX["OFX"]): StatementGroup[] {
  const groups: StatementGroup[] = []
  for (const trnrs of toArray(ofx?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS)) {
    groups.push({
      transactions: toArray(trnrs?.CCSTMTRS?.BANKTRANLIST?.STMTTRN),
      isCreditCard: true,
    })
  }
  for (const trnrs of toArray(ofx?.BANKMSGSRSV1?.STMTTRNRS)) {
    groups.push({
      transactions: toArray(trnrs?.STMTRS?.BANKTRANLIST?.STMTTRN),
      isCreditCard: false,
    })
  }
  return groups
}

function toRecord(
  txn: ofxTypes.StatementTransaction,
  isCreditCard: boolean,
  sourceAccount: string,
): StagedRecord | null {
  const amount = amountToCents(txn.TRNAMT)
  if (amount === null) return null
  return {
    date: ofxDateToIso(txn.DTPOSTED),
    amount,
    type: classifyType(txn.TRNTYPE, amount, isCreditCard),
    description: buildDescription(txn.NAME ?? txn.PAYEE?.NAME, txn.MEMO),
    sourceAccount,
    sourceCategory: "",
  }
}

/** OFX `TRNAMT` is a plain signed decimal (`-9.99`, `666.10`) already in capy's
 *  sign convention: negative = outflow. Reuse the CSV path's currency parser so
 *  both round to cents identically. */
function amountToCents(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null
  try {
    return parseCurrencyToCents(raw, "plain", 0)
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
 * payment (an expense). Everything else is typed by amount sign — grounding's
 * payment-leg recognition and the classifier take it from there, exactly as for
 * a CSV row the mapper didn't flag.
 */
function classifyType(
  trntype: string | undefined,
  amount: number,
  isCreditCard: boolean,
): StagedRecord["type"] {
  const t = (trntype ?? "").toUpperCase()
  if (t === "XFER") return "transfer"
  if (isCreditCard && t === "PAYMENT") return "transfer"
  return amount < 0 ? "expense" : "income"
}

function buildDescription(name: string | undefined, memo: string | undefined): string {
  const n = (name ?? "").trim()
  const m = (memo ?? "").trim()
  if (n && m && n.toLowerCase() !== m.toLowerCase()) return `${n} ${m}`
  return n || m
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}
