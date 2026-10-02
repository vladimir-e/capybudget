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
    "euro", "euros",
    "kr", "kn", "zł", "zl", "kč", "kc", "ft", "lei", "din", "tl", "fr", "sfr",
    "руб", "р", "лв", "грн", "дин", "ден", "сом", "тг",
    "rs", "rp", "rm", "tk", "ksh", "bs", "gs", "r",
    "रु", "रू", "円", "元", "圓", "원", "บาท",
    "s/", "r$", "us$", "c$", "a$", "nz$", "hk$", "s$", "nt$", "mx$", "rd$",
  ],
);

export function isCurrencyText(token: string): boolean {
  if (/^\p{Sc}$/u.test(token)) return true;
  const word = token.replace(/\.$/, "");
  return ISO_4217.has(word) || LOCAL_CURRENCY_TEXT.has(word.toLowerCase());
}
