/** Format cents as a display string: 1250 → "$12.50" */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${String(remainder).padStart(2, "0")}`;
}

/** CSS class for amount coloring based on transaction type */
export function getAmountClass(txn: { type: string; amount: number }): string {
  if (txn.type === "transfer") return "text-amount-transfer";
  if (txn.amount < 0) return "text-amount-expense";
  return "text-amount-income";
}

/** Parse a dollar string to cents: "$12.50" → 1250, "12.5" → 1250 */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}
