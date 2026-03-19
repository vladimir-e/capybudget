import { useCallback } from "react";
import { join as joinPath } from "@tauri-apps/api/path";

export function useImportPaths(budgetPath: string) {
  const resolveImportPath = useCallback(
    async (filename: string) => {
      const capyDir = await joinPath(budgetPath, ".capy");
      const importDir = await joinPath(capyDir, "import");
      return joinPath(importDir, filename);
    },
    [budgetPath],
  );

  const resolveAliasPath = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    return joinPath(capyDir, "aliases.json");
  }, [budgetPath]);

  return { resolveImportPath, resolveAliasPath };
}
