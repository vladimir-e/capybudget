// Long-form guide prose lives in per-locale modules rather than catalog JSON —
// paragraphs are unmaintainable as flat key/value strings (the short nav chrome
// still goes through the `help` namespace). Authored as a structured array so
// the sidebar derives anchors from `id`/`title` and scroll-spy observes by id;
// inline emphasis is HelpScreen's `**bold**` parser, so keep markup to bold
// spans and bullet lists. The promo site mirrors the English copy as MDX at
// apps/www/src/content/docs/user-guide.mdx — keep them in sync when it changes.

import { useLocale } from "@capybudget/i18n";
import { EN_HELP_GUIDE } from "./help-guide-content.en";
import { RU_HELP_GUIDE } from "./help-guide-content.ru";
import { ES_HELP_GUIDE } from "./help-guide-content.es";

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
  /** Stable anchor id, shared across translations so links/scroll-spy don't
   *  depend on the displayed wording. */
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
  es: ES_HELP_GUIDE,
};

export function useHelpGuide(): HelpGuide {
  const locale = useLocale();
  return GUIDES[locale] ?? EN_HELP_GUIDE;
}
