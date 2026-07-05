import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "**/.astro/**",
      "src/routeTree.gen.ts",
      "apps/demo/src/routeTree.gen.ts",
      "src-tauri",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      "packages/app/src/routes/**/*.tsx",
      "packages/app/src/components/ui/**/*.tsx",
      "apps/demo/src/routes/**/*.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["apps/demo/src/stubs/**/*.ts", "apps/demo/src/adapters/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Route `toast` through the app wrapper so error toasts persist until
  // dismissed. `Toaster` still comes straight from sonner; tests mock the lib
  // directly, and the wrapper itself is the one sanctioned importer.
  {
    files: ["packages/app/src/**/*.{ts,tsx}", "apps/demo/src/**/*.{ts,tsx}"],
    ignores: ["packages/app/src/lib/toast.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "sonner",
              importNames: ["toast"],
              message: "Import `toast` from '@/lib/toast' so error toasts persist until dismissed.",
            },
          ],
        },
      ],
    },
  },
  // Untranslated-string guardrail: every user-facing literal in the React UI
  // must route through the i18n layer. Scoped to the rendered surfaces only —
  // the non-UI packages (core/persistence/intelligence/mcp) emit no copy.
  {
    files: ["packages/app/src/**/*.tsx", "apps/demo/src/**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          // jsx-only: flag JSX text and JSX attribute values, but never plain
          // literals in non-JSX code (option objects, enum maps, store keys).
          mode: "jsx-only",
          "jsx-attributes": {
            // Only these four attributes carry user copy. Everything else —
            // structural, technical, routing, styling — is excluded so the
            // rule fires on real translation misses, not framework plumbing.
            include: ["aria-label", "placeholder", "title", "alt"],
          },
          words: {
            exclude: [
              // Pure punctuation / symbol / digit / whitespace runs —
              // separators and glyphs (em dash, bullet, middle dot, ellipsis,
              // arrows, numbers, currency), never prose, which carries letters.
              /^[\s\d\p{P}\p{S}]+$/u,
              // ALL-CAPS tokens (enum-ish constants, not prose).
              "[A-Z_-]+",
              // CSS / Tailwind class-token strings flowing into className or
              // style via an intermediate const — every space-separated token
              // is a hyphen/slash/colon slug, a shape ordinary copy never has.
              /^(?:[a-z][a-z0-9]*[-/:][a-z0-9/:.[\]%-]*)(?:\s+[a-z][a-z0-9]*[-/:.][a-z0-9/:.[\]%-]*)*$/,
              // Bare CSS keyword values (stroke/fill/color literals).
              /^(?:transparent|currentColor|inherit|initial|none|auto)$/,
              // Brand and proper nouns — user-visible but not translatable.
              "Capy",
              "Capybudget",
              "Capy Budget",
              "capybudget\\.app",
              "Anthropic",
              "OpenAI",
              "Claude",
              "Claude Code",
              "Ollama",
              "GPT",
              "CSV",
              "AI",
              "MCP",
            ],
          },
          callees: {
            // Don't flag arguments to these calls — translation, class-name,
            // and DOM/event plumbing helpers that never take user copy.
            exclude: [
              "i18n(ext)?",
              "t",
              "cn",
              "clsx",
              "cva",
              "require",
              "addEventListener",
              "removeEventListener",
              "querySelector",
              "querySelectorAll",
              "getElementById",
              "includes",
              "indexOf",
              "endsWith",
              "startsWith",
              "split",
              "matchMedia",
            ],
          },
        },
      ],
    },
  },
);
