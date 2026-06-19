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
