import { describe, expect, it } from "vitest"
import { normalizeOfx } from "./ofx"

// Synthetic fixtures modelled on real OFX-family exports — fake merchants, ids,
// and amounts. Structure mirrors OFX 1.02 SGML (unclosed leaf tags, closed
// STMTTRN containers) and OFX 2.x XML.

const SGML_HEADER = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "SECURITY:NONE",
  "ENCODING:USASCII",
  "CHARSET:1252",
  "COMPRESSION:NONE",
  "OLDFILEUID:NONE",
  "NEWFILEUID:NONE",
  "",
  "",
].join("\n")

/** Credit-card statement: two purchases (DEBIT, negative) and one card payoff
 *  (PAYMENT, positive). ORG names the institution. */
const CC_SGML =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG<FI><ORG>Testograph Card<FID>99999</FI></SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>xxxx-test-1</CCACCTFROM>" +
  "<BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115120000[0:GMT]<TRNAMT>-12.34<FITID>fit-001<NAME>COFFEE BAR 42 MAIN ST</STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110120000[0:GMT]<TRNAMT>-5.00<FITID>fit-002<NAME>NEWSSTAND</STMTTRN>" +
  "<STMTTRN><TRNTYPE>PAYMENT<DTPOSTED>20260105120000[0:GMT]<TRNAMT>200.00<FITID>fit-003<NAME>ONLINE PAYMENT THANK YOU</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>-17.34<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** Bank checking statement: a DEBIT with a MEMO, a CREDIT (payroll), an XFER,
 *  and a PAYMENT (bill pay — an expense on a bank account, not a transfer).
 *  DTPOSTED here omits the [zone] suffix, as some banks emit. */
const BANK_SGML =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<DTSERVER>20260201000000<LANGUAGE>ENG<FI><ORG>Testograph Bank<FID>10101</FI></SONRS></SIGNONMSGSRSV1>" +
  "<BANKMSGSRSV1><STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>011000015<ACCTID>bank-acct-9<ACCTTYPE>CHECKING</BANKACCTFROM>" +
  "<BANKTRANLIST><DTSTART>20260101000000<DTEND>20260201000000" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260112000000<TRNAMT>-40.00<FITID>b-1<NAME>GROCERY MART<MEMO>WEEKLY SHOP</STMTTRN>" +
  "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260101000000<TRNAMT>1500.00<FITID>b-2<NAME>PAYROLL DEPOSIT</STMTTRN>" +
  "<STMTTRN><TRNTYPE>XFER<DTPOSTED>20260108000000<TRNAMT>-100.00<FITID>b-3<NAME>MOVE TO SAVINGS</STMTTRN>" +
  "<STMTTRN><TRNTYPE>PAYMENT<DTPOSTED>20260120000000<TRNAMT>-60.00<FITID>b-4<NAME>ELECTRIC CO BILLPAY</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>1300.00<DTASOF>20260201000000</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"

/** OFX 2.x — same body as CC_SGML's first two txns, but well-formed XML. */
const CC_XML =
  '<?xml version="1.0" encoding="US-ASCII"?>\n' +
  '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n' +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>" +
  "<DTSERVER>20260201120000</DTSERVER><LANGUAGE>ENG</LANGUAGE>" +
  "<FI><ORG>Testograph Card</ORG><FID>99999</FID></FI></SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>" +
  "<CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>xxxx-test-1</ACCTID></CCACCTFROM>" +
  "<BANKTRANLIST><DTSTART>20260101120000</DTSTART><DTEND>20260201120000</DTEND>" +
  "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260115120000</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>fit-001</FITID><NAME>COFFEE BAR 42 MAIN ST</NAME></STMTTRN>" +
  "<STMTTRN><TRNTYPE>PAYMENT</TRNTYPE><DTPOSTED>20260105120000</DTPOSTED><TRNAMT>200.00</TRNAMT><FITID>fit-003</FITID><NAME>ONLINE PAYMENT THANK YOU</NAME></STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>187.66</BALAMT><DTASOF>20260201120000</DTASOF></LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** Single transaction — ofx-js returns STMTTRN as an object, not an array. */
const CC_SINGLE =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>solo-1</CCACCTFROM><BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115120000[0:GMT]<TRNAMT>-9.99<FITID>solo-fit<NAME>SOLO SHOP</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>-9.99<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** qbo-style: NAME truncated to 32 chars, INTU.BID present, no ORG. */
const QBO_TRUNCATED =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG<FI><ORG>Testograph Card<FID>99999</FI><INTU.BID>99999</SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>qbo-1</CCACCTFROM><BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115120000[0:GMT]<TRNAMT>-77.00<FITID>qbo-fit<NAME>VERYLONGMERCHANTNAME TRUNCATED T</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>-77.00<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** Valid OFX, empty transaction list. */
const NO_TXNS =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>" +
  "<CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>empty-1</CCACCTFROM><BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>0.00<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

describe("normalizeOfx — credit card", () => {
  const { rows } = normalizeOfx({ name: "card.ofx", content: CC_SGML })

  it("parses every transaction with continuing ids", () => {
    expect(rows.map((r) => r.id)).toEqual(["imp-1", "imp-2", "imp-3"])
  })

  it("maps DTPOSTED (date part only), TRNAMT (signed cents), and NAME", () => {
    expect(rows[0]).toMatchObject({
      date: "2026-01-15",
      amount: -1234,
      type: "expense",
      description: "COFFEE BAR 42 MAIN ST",
    })
    expect(rows[1]).toMatchObject({ date: "2026-01-10", amount: -500, type: "expense" })
  })

  it("classifies a credit-card PAYMENT as a transfer, not income", () => {
    expect(rows[2]).toMatchObject({ amount: 20000, type: "transfer", description: "ONLINE PAYMENT THANK YOU" })
  })

  it("uses the FI organization name as the source account", () => {
    expect(rows.every((r) => r.sourceAccount === "Testograph Card")).toBe(true)
  })

  it("leaves resolved fields empty for grounding to fill", () => {
    expect(rows[0]).toMatchObject({ merchant: "", accountId: "", categoryId: "", targetAccountId: "" })
  })
})

describe("normalizeOfx — bank statement", () => {
  const { rows } = normalizeOfx({ name: "checking.qfx", content: BANK_SGML })

  it("types by amount sign, with XFER as transfer and bank PAYMENT as expense", () => {
    const byName = Object.fromEntries(rows.map((r) => [r.description.split(" ")[0], r]))
    expect(byName["GROCERY"]).toMatchObject({ amount: -4000, type: "expense" })
    expect(byName["PAYROLL"]).toMatchObject({ amount: 150000, type: "income" })
    expect(byName["MOVE"]).toMatchObject({ amount: -10000, type: "transfer" })
    expect(byName["ELECTRIC"]).toMatchObject({ amount: -6000, type: "expense" })
  })

  it("joins NAME and MEMO into the description", () => {
    const grocery = rows.find((r) => r.description.startsWith("GROCERY"))
    expect(grocery?.description).toBe("GROCERY MART WEEKLY SHOP")
  })

  it("parses a DTPOSTED without a zone suffix", () => {
    expect(rows.find((r) => r.description.startsWith("PAYROLL"))?.date).toBe("2026-01-01")
  })
})

describe("normalizeOfx — format variants", () => {
  it("parses OFX 2.x XML the same as SGML", () => {
    const { rows } = normalizeOfx({ name: "card.ofx", content: CC_XML })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: "2026-01-15", amount: -1234, type: "expense" })
    expect(rows[1]).toMatchObject({ amount: 20000, type: "transfer" })
  })

  it("handles a single transaction (object, not array)", () => {
    const { rows } = normalizeOfx({ name: "solo.ofx", content: CC_SINGLE })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: "2026-01-15", amount: -999, description: "SOLO SHOP" })
  })

  it("carries a truncated qbo name through unchanged", () => {
    const { rows } = normalizeOfx({ name: "card.qbo", content: QBO_TRUNCATED })
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe("VERYLONGMERCHANTNAME TRUNCATED T")
  })
})

describe("normalizeOfx — empty and malformed", () => {
  it("yields no rows for a statement with no transactions", () => {
    expect(normalizeOfx({ name: "empty.ofx", content: NO_TXNS }).rows).toEqual([])
  })

  it("yields no rows (never throws) for a malformed file", () => {
    expect(normalizeOfx({ name: "junk.ofx", content: "this is not ofx at all" }).rows).toEqual([])
    expect(normalizeOfx({ name: "junk.ofx", content: "" }).rows).toEqual([])
  })

  it("falls back to a filename-derived account when the file names no institution", () => {
    const { rows } = normalizeOfx({ name: "my-checking-export.ofx", content: CC_SINGLE })
    // CC_SINGLE carries no FI/ORG, so the account heals from the filename.
    expect(rows[0].sourceAccount).toBe("my checking export")
  })
})
