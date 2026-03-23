import { useCallback } from "react";
import { join as joinPath } from "@tauri-apps/api/path";

export function useImportPaths(budgetPath: string) {
  /** Resolve a path inside .capy/import/ (e.g. "transactions.csv"). */
  const resolveImportPath = useCallback(
    async (filename: string) => {
      const capyDir = await joinPath(budgetPath, ".capy");
      const importDir = await joinPath(capyDir, "import");
      return joinPath(importDir, filename);
    },
    [budgetPath],
  );

  /** Resolve a path inside .capy/import/sources/ (e.g. "2019.csv"). */
  const resolveSourcePath = useCallback(
    async (filename: string) => {
      const capyDir = await joinPath(budgetPath, ".capy");
      const importDir = await joinPath(capyDir, "import");
      const sourcesDir = await joinPath(importDir, "sources");
      return joinPath(sourcesDir, filename);
    },
    [budgetPath],
  );

  /** Resolve the .capy/import/sources/ directory path. */
  const resolveSourcesDir = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    const importDir = await joinPath(capyDir, "import");
    return joinPath(importDir, "sources");
  }, [budgetPath]);

  /** Resolve the .capy/import/ directory path. */
  const resolveImportDir = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    return joinPath(capyDir, "import");
  }, [budgetPath]);

  const resolveAliasPath = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    return joinPath(capyDir, "aliases.json");
  }, [budgetPath]);

  const resolveLogPath = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    return joinPath(capyDir, "import-log.json");
  }, [budgetPath]);

  return {
    resolveImportPath,
    resolveSourcePath,
    resolveSourcesDir,
    resolveImportDir,
    resolveAliasPath,
    resolveLogPath,
  };
}
