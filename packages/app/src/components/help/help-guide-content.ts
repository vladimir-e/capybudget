// Source of truth for the in-app user guide rendered by HelpScreen.
//
// Authored as a structured array (not a markdown file) so the Help sidebar can
// derive its anchors directly from `id`/`title` with no parser, and scroll-spy
// can observe each section by id. Inline emphasis is rendered by HelpScreen's
// lightweight `**bold**` parser — keep markup to bold spans and bullet lists.
//
// The promo site (apps/www/src/content/docs/) carries the same copy as MDX for
// SEO. The two surfaces are intentionally separate (Astro vs Vite); when this
// copy changes, mirror it there.

export interface HelpListItem {
  /** Leading bold lead-in, e.g. "Expense" in "**Expense** — money out." */
  term?: string;
  /** Remainder of the item; supports inline `**bold**`. */
  text: string;
}

export type HelpBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: HelpListItem[] };

export interface HelpSection {
  id: string;
  title: string;
  blocks: HelpBlock[];
}

export const HELP_TITLE = "Capy Budget — user guide";

export const HELP_INTRO =
  "Everything in your budget is a transaction. Every balance, total, and chart the app shows is computed from that one list. Keep the list accurate and everything downstream is correct.";

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "what-you-put-in",
    title: "What you put in",
    blocks: [
      { kind: "paragraph", text: "**Transactions** — every time money moves:" },
      {
        kind: "list",
        items: [
          { term: "Expense", text: "money out." },
          { term: "Income", text: "money in." },
          {
            term: "Transfer",
            text: "money between your own accounts (to savings, paying a credit card). Not spending.",
          },
        ],
      },
      {
        kind: "paragraph",
        text: "A credit-card purchase is an expense; paying that card later is a transfer, not new spending — the one thing worth getting right.",
      },
      {
        kind: "paragraph",
        text: "**Accounts** — anywhere value sits: checking, cash, savings, credit cards, loans, crypto. You never type a balance; it's the sum of the account's transactions. Debts are negative balances.",
      },
      {
        kind: "paragraph",
        text: "**Categories** — where money goes, grouped by how much control you have over it (fixed costs, day-to-day, irregular). Sensible defaults from the start; change them freely.",
      },
    ],
  },
  {
    id: "getting-it-in",
    title: "Getting it in",
    blocks: [
      {
        kind: "paragraph",
        text: "Enter transactions by hand, or give Capy a bank CSV, a statement screenshot, or a photo of a receipt — it enters and categorizes them for you. Import your history and you start with months of data instead of a blank slate.",
      },
    ],
  },
  {
    id: "what-you-get-back",
    title: "What you get back",
    blocks: [
      { kind: "paragraph", text: "Each view answers one question:" },
      {
        kind: "list",
        items: [
          { term: "Spending", text: "where did it go?" },
          { term: "Cash Flow", text: "is my lifestyle sustainable?" },
          { term: "Net Worth", text: "am I saving?" },
          { term: "Compare", text: "how do categories trend against each other?" },
          {
            term: "Monthly Budget",
            text: "am I on track this month? A forward-looking view built from your past spending, so it gets useful once you have a couple of months of history.",
          },
        ],
      },
    ],
  },
  {
    id: "capy",
    title: "Capy",
    blocks: [
      {
        kind: "paragraph",
        text: "Capy is the optional AI layer. Ask it to import and categorize transactions, find recurring charges like subscriptions, or anything else you'd do in the app yourself. The app works fully without it.",
      },
    ],
  },
];
