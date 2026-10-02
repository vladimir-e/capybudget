const ISO_4217 = new Set(
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL
   BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD
   EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS
   INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD
   LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK
   NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK
   SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS
   UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL`.split(/\s+/),
);

const LOCAL_CURRENCY_TEXT = new Set(
  [
    "euro", "euros", "rmb", "m.n", "br",
    "kr", "kn", "zł", "zl", "kč", "kc", "ft", "lei", "din", "tl", "fr", "sfr",
    "руб", "р", "лв", "грн", "дин", "ден", "сом", "тг",
    "rs", "rp", "rm", "tk", "ksh", "bs", "gs",
    "रु", "रू", "円", "元", "圓", "원", "บาท",
    "s/", "r$", "us$", "c$", "a$", "au$", "ca$", "nz$", "hk$", "s$", "nt$", "mx$", "rd$",
  ],
);

const PREFIX_ONLY_CURRENCY_TEXT = new Set(["r"]);

export type AffixSide = "prefix" | "suffix";

export function isCurrencyText(token: string, side: AffixSide): boolean {
  if (/^\p{Sc}$/u.test(token)) return true;
  const word = token.normalize("NFC").replace(/\.$/, "").toLowerCase();
  return (
    ISO_4217.has(word.toUpperCase()) ||
    LOCAL_CURRENCY_TEXT.has(word) ||
    (side === "prefix" && PREFIX_ONLY_CURRENCY_TEXT.has(word))
  );
}
