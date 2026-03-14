/** Naive English pluralizer: pluralize(1, "cat") → "1 cat", pluralize(3, "cat") → "3 cats" */
export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? "s" : ""}`;
}
