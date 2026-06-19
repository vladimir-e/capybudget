/**
 * CLI wrapper for the catalog parity check (`npm run i18n:check`). Exits
 * non-zero on any problem — the guardrail that keeps a contributor PR ("copy
 * en/, translate the values") from silently shipping a drifted catalog. The
 * same check runs in the vitest suite via `parity.test.ts`, so `npm test`
 * fails on drift too.
 */
import { checkParity } from "./parity";

const { problems, localeCount, namespaceCount } = checkParity();

if (problems.length > 0) {
  console.error(`i18n:check failed — ${problems.length} issue(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `i18n:check passed — ${localeCount} locale(s) × ${namespaceCount} namespace(s), keys in parity with "en".`,
);
