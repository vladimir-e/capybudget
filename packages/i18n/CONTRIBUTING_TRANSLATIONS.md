# Translating Capy Budget

All UI text lives in JSON catalogs under `locales/<lang>/<namespace>.json`. English
(`en`) is the source of truth; every other language mirrors its key structure.
Adding a language is two edits: the JSON catalogs, and one line registering the
language. The catalogs load automatically — there is no per-locale wiring file to
keep in sync.

## Add a language

1. Copy the English folder to your language code (BCP-47 primary subtag):

   ```bash
   cp -r locales/en locales/<lang>      # e.g. locales/de
   ```

2. Translate the **values** in each JSON file. Keep every **key** exactly as it
   is — keys are what the code looks up; only the text on the right changes.

   ```json
   // locales/de/common.json
   { "nav": { "accounts": "Konten", "budget": "Budget" } }
   ```

3. Register the language in `src/locales.ts` by adding an entry to
   `SUPPORTED_LOCALES`:

   ```ts
   { code: "de", label: "Deutsch", aiLanguage: "German" }
   ```

   - `label` — the language's own name (endonym), shown in the picker.
   - `aiLanguage` — the language's English name, injected into the AI prompt so
     Capy replies in it.

   This is the *only* code line you touch. The resource loader globs the
   `locales/` directories, so it picks up your catalogs from the registry entry
   alone — there's no separate import list to update.

4. Check key parity against English:

   ```bash
   npm run i18n:check
   ```

   It fails loudly on any missing or extra key (per namespace), and on a locale
   that's registered but has no directory — or has a directory but isn't
   registered. Fix until it passes. The same check runs in CI and in the test
   suite, so the gate can't be skipped.

## Rules

- **Never add, remove, or rename keys.** If English doesn't have a key, neither
  should you. New keys land in `en` first (a code change), then ripple out.
- **Keep `{{placeholders}}` intact.** `"Reset to {{currency}} defaults"` must
  keep `{{currency}}` — only the surrounding words translate. Reorder them to fit
  your grammar; don't rename them.
- **Translate naturally, not literally.** Use the conventional banking/budgeting
  term in your language, not a word-for-word rendering.
- **Product names stay as-is.** "Capy", "Claude Code", "Anthropic API",
  "OpenAI API" are brand names — leave them in English.

## Plurals

Plural keys use i18next's `Intl.PluralRules` suffixes — the set of suffixes
depends on the language. English has two forms; Russian has four:

```json
// en
{ "count_one": "{{count}} category", "count_other": "{{count}} categories" }

// ru — one / few / many
{
  "count_one":  "{{count}} категория",
  "count_few":  "{{count}} категории",
  "count_many": "{{count}} категорий"
}
```

Provide exactly the forms your language's CLDR plural rules define. `i18n:check`
collapses plural suffixes to their base key, so it won't flag a legitimate
difference in plural-form count between languages.

## Namespaces

Catalogs are split by area so files stay small and reviewable:

| Namespace    | Covers                                       |
| ------------ | -------------------------------------------- |
| `common`     | Navigation labels, shared action buttons     |
| `settings`   | The Settings screen and its sections         |
| `budget`     | Budget/accounts/transactions UI              |
| `analytics`  | The analytics tabs (charts, drilldowns)      |
| `import`     | The Import flow                              |
| `capy`       | The Capy chat assistant UI                   |
| `onboarding` | First-run / onboarding                       |
| `help`       | Help-screen chrome (header, anchors, links)  |

A file may be `{}` while its area hasn't been translated to keys yet — translate
the ones with content; leave empty ones empty.

## Help guide

The Help screen's chrome (the "Help" header, the section anchors, the demo link)
lives in the `help` catalog namespace like everything else. Its **long-form
prose**, though — the multi-paragraph "How budgeting works" guide — does not:
paragraphs of copy are unmaintainable as flat JSON values, so each language gets
its own content module under
`packages/app/src/components/help/help-guide-content.<lang>.ts` (e.g.
`help-guide-content.ru.ts`), selected at render time off the active locale.

To translate the guide for a new language, copy `help-guide-content.en.ts` to
your language code, translate the prose, and register it in the `GUIDES` map in
`help-guide-content.ts`. Keep each section's `id` unchanged — it's the stable
anchor the sidebar and scroll-spy rely on; only `title`/`intro`/`text` translate.
