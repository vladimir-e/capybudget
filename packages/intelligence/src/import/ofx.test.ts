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

/** Two bank statements in one file (repeated STMTTRNRS), distinct ACCTIDs. */
const BANK_MULTI =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201000000<LANGUAGE>ENG<FI><ORG>Testograph Bank<FID>10101</FI></SONRS></SIGNONMSGSRSV1>" +
  "<BANKMSGSRSV1>" +
  "<STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>011000015<ACCTID>acct-1111<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260101000000<DTEND>20260201000000<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115000000<TRNAMT>-10.00<FITID>c-1<NAME>CHECKING BUY</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-10.00<DTASOF>20260201000000</LEDGERBAL></STMTRS></STMTTRNRS>" +
  "<STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>011000015<ACCTID>acct-2222<ACCTTYPE>SAVINGS</BANKACCTFROM><BANKTRANLIST><DTSTART>20260101000000<DTEND>20260201000000<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260116000000<TRNAMT>25.00<FITID>s-1<NAME>SAVINGS INTEREST</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>25.00<DTASOF>20260201000000</LEDGERBAL></STMTRS></STMTTRNRS>" +
  "</BANKMSGSRSV1></OFX>"

/** Comma-decimal (european) and comma-thousands (US) amounts in one CC file. */
const COMMA_AMOUNTS =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG<FI><ORG>Testograph Card<FID>99999</FI></SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><CCSTMTRS><CURDEF>EUR<CCACCTFROM><ACCTID>eu-1</CCACCTFROM><BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115120000[0:GMT]<TRNAMT>-12,34<FITID>eu-a<NAME>KAFFEEHAUS</STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110120000[0:GMT]<TRNAMT>-1,234.56<FITID>eu-b<NAME>BIG US PURCHASE</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>-1246.90<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** One good row, one with an unparseable amount (should drop, not crash). */
const BAD_AMOUNT =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000[0:GMT]<LANGUAGE>ENG<FI><ORG>Testograph Card<FID>99999</FI></SONRS></SIGNONMSGSRSV1>" +
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>bad-1</CCACCTFROM><BANKTRANLIST><DTSTART>20260101120000[0:GMT]<DTEND>20260201120000[0:GMT]" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115120000[0:GMT]<TRNAMT>-5.00<FITID>ok-1<NAME>GOOD ROW</STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110120000[0:GMT]<TRNAMT>N/A<FITID>bad-1<NAME>BAD ROW</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>-5.00<DTASOF>20260201120000[0:GMT]</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>"

/** Zero amount, PAYEE (no NAME), NAME==MEMO, missing TRNTYPE, bare 8-char date. */
const FIELD_VARIANTS =
  SGML_HEADER +
  "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201000000<LANGUAGE>ENG<FI><ORG>Testograph Bank<FID>10101</FI></SONRS></SIGNONMSGSRSV1>" +
  "<BANKMSGSRSV1><STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>011000015<ACCTID>v-acct<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260101000000<DTEND>20260201000000" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115<TRNAMT>-1.00<FITID>v-1<PAYEE><NAME>JANE PAYEE<ADDR1>1 MAIN ST<CITY>TOWN<STATE>CA<POSTALCODE>90001<PHONE>5551234</PAYEE></STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260114<TRNAMT>-2.00<FITID>v-2<NAME>DUPE CO<MEMO>dupe co</STMTTRN>" +
  "<STMTTRN><DTPOSTED>20260113<TRNAMT>-3.00<FITID>v-3<NAME>NO TYPE</STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEP<DTPOSTED>20260112<TRNAMT>0.00<FITID>v-4<NAME>ZERO ROW</STMTTRN>" +
  "</BANKTRANLIST><LEDGERBAL><BALAMT>0.00<DTASOF>20260201000000</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"

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

describe("normalizeOfx — amounts", () => {
  it("reads a comma decimal as european, and comma thousands as plain", () => {
    const { rows } = normalizeOfx({ name: "eu.ofx", content: COMMA_AMOUNTS })
    expect(rows[0]).toMatchObject({ description: "KAFFEEHAUS", amount: -1234 }) // "-12,34"
    expect(rows[1]).toMatchObject({ description: "BIG US PURCHASE", amount: -123456 }) // "-1,234.56"
  })

  it("drops a row with an unparseable amount and reports it, keeping the rest", () => {
    const { rows, dropped } = normalizeOfx({ name: "bad.ofx", content: BAD_AMOUNT })
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe("GOOD ROW")
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toContain("bad-1")
  })
})

describe("normalizeOfx — multiple accounts in one file", () => {
  it("disambiguates each statement's source account by its id tail", () => {
    const { rows } = normalizeOfx({ name: "both.ofx", content: BANK_MULTI })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.sourceAccount)).toEqual([
      "Testograph Bank 1111",
      "Testograph Bank 2222",
    ])
  })
})

describe("normalizeOfx — field variants", () => {
  const { rows } = normalizeOfx({ name: "variants.ofx", content: FIELD_VARIANTS })
  const byId = Object.fromEntries(rows.map((r) => [r.description, r]))

  it("falls back to PAYEE.NAME when NAME is absent", () => {
    expect(byId["JANE PAYEE"]).toBeDefined()
  })

  it("does not duplicate a description when NAME and MEMO are the same", () => {
    expect(byId["DUPE CO"]).toBeDefined()
    expect(rows.some((r) => /dupe co/i.test(r.description) && r.description !== "DUPE CO")).toBe(false)
  })

  it("types a row with no TRNTYPE by amount sign", () => {
    expect(byId["NO TYPE"]).toMatchObject({ type: "expense" })
  })

  it("parses a bare 8-char DTPOSTED", () => {
    expect(byId["NO TYPE"].date).toBe("2026-01-13")
  })

  it("types a zero amount as expense, matching the CSV path", () => {
    expect(byId["ZERO ROW"]).toMatchObject({ amount: 0, type: "expense" })
  })
})

describe("normalizeOfx — empty and malformed", () => {
  it("yields no rows for a statement with no transactions", () => {
    const { rows, dropped } = normalizeOfx({ name: "empty.ofx", content: NO_TXNS })
    expect(rows).toEqual([])
    expect(dropped).toEqual([])
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
