import type { TFunction } from "i18next";
import { PROVIDER_LABELS, deadEndKind, ollamaOrigin } from "@capybudget/intelligence";
import type { ImportRunError } from "@/stores/import-store";

export function importErrorCopy(
  error: ImportRunError,
  t: TFunction<["import", "common"]>,
  ollamaBaseUrl: string,
): string {
  const provider = error.provider ? PROVIDER_LABELS[error.provider] : "";
  if (error.reason === "unreachable") {
    return error.provider === "ollama"
      ? t("errors.ollamaUnreachable", { url: ollamaOrigin(ollamaBaseUrl) })
      : t("errors.unreachable", { provider });
  }
  const deadEnd = deadEndKind(error);
  if (provider && deadEnd && deadEnd !== "unreachable") return t(`errors.${deadEnd}`, { provider });
  if (error.reason === "categorize") return t("errors.categorizeFailed");
  return error.message;
}
