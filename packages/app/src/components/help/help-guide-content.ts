// Shape of the in-app user guide rendered by HelpScreen.
//
// The prose itself is locale-keyed: `help-guide-content.en.ts` /
// `help-guide-content.ru.ts`, picked at render time by `useHelpGuide()` off the
// active locale. Long-form copy lives in these modules rather than catalog JSON
// because paragraphs of prose are unmaintainable as flat key/value strings; the
// short nav chrome (the "Help" header, the back control, the section anchors)
// goes through the `help` catalog namespace instead.
//
// Authored as a structured array (not a markdown file) so the Help sidebar can
// derive its anchors directly from `id`/`title` with no parser, and scroll-spy
// can observe each section by id. Inline emphasis is rendered by HelpScreen's
// lightweight `**bold**` parser — keep markup to bold spans and bullet lists.
//
// The promo site mirrors the English copy as MDX at
// apps/www/src/content/docs/user-guide.mdx for SEO. The two surfaces are
// intentionally separate (Astro vs Vite); when the English copy changes, mirror
// it there.

import { useLocale } from "@capybudget/i18n";
import { EN_HELP_GUIDE } from "./help-guide-content.en";
import { RU_HELP_GUIDE } from "./help-guide-content.ru";

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
  /** Stable anchor id — locale-independent, shared by every translation so the
   *  sidebar links and scroll-spy don't depend on the displayed wording. */
  id: string;
  title: string;
  blocks: HelpBlock[];
}

export interface HelpGuide {
  title: string;
  intro: string;
  sections: HelpSection[];
}

const GUIDES: Record<string, HelpGuide> = {
  en: EN_HELP_GUIDE,
  ru: RU_HELP_GUIDE,
};

/** The user guide in the active locale, falling back to English. */
export function useHelpGuide(): HelpGuide {
  const locale = useLocale();
  return GUIDES[locale] ?? EN_HELP_GUIDE;
}
