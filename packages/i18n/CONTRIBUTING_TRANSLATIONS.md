# Translating Capy Budget

All UI text lives in JSON catalogs under `locales/<lang>/<namespace>.json`. English
(`en`) is the source of truth; every other language mirrors its key structure.
Translating is a copy-and-edit job — you never touch code.

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

4. Check key parity against English:

   ```bash
   npm run i18n:check
   ```

   It fails loudly on any missing or extra key, per namespace. Fix until it passes.

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

| Namespace    | Covers                                   |
| ------------ | ---------------------------------------- |
| `common`     | Navigation labels, shared action buttons |
| `settings`   | The Settings screen and its sections     |
| `budget`     | Budget/accounts/transactions UI          |
| `import`     | The Import flow                          |
| `capy`       | The Capy chat assistant UI               |
| `onboarding` | First-run / onboarding                   |

A file may be `{}` while its area hasn't been translated to keys yet — translate
the ones with content; leave empty ones empty.
