import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { i18n } from "@capybudget/i18n";
import type { ImportNotice } from "@capybudget/intelligence";
import { importNoticeText } from "./import-notice-text";

function textIn(lng: string, notice: ImportNotice, ollamaBaseUrl = ""): string {
  const t = i18n.getFixedT(lng, ["import", "common"]) as TFunction<["import", "common"]>;
  return importNoticeText(notice, { t, ollamaBaseUrl });
}

describe("importNoticeText", () => {
  it("words a cut-off batch differently from a cut-off file", () => {
    const file = textIn("en", { code: "normalize.fileSkipped", params: { file: "scan.png", cause: { kind: "cutOff" } } });
    const batch = textIn("en", {
      code: "categorize.batchFailed",
      params: { batch: 2, count: 25, cause: { kind: "cutOff" } },
    });

    expect(file).toContain("Try a smaller file");
    expect(batch).toBe("Batch 2 failed (25 rows left for re-run): the AI's reply was cut off before the batch was complete");
    expect(batch).not.toContain("smaller file");
  });

  it("shows a provider's own message verbatim", () => {
    expect(
      textIn("ru", { code: "categorize.noneLanded", params: { count: 5, cause: { kind: "other", detail: "overloaded" } } }),
    ).toBe("Не удалось распределить по категориям ни одну из 5 строк — overloaded. Нажми «Обработать», чтобы попробовать ещё раз.");
  });

  it("names the Ollama server it can't reach", () => {
    expect(
      textIn("en", { code: "deadEnd", params: { kind: "unreachable", provider: "ollama" } }, "http://box:11434/v1"),
    ).toBe("Can't reach Ollama at http://box:11434. Start it with `ollama serve`, or check the URL in Settings.");
  });

  it("words a rejected key with the provider's name", () => {
    expect(textIn("es", { code: "deadEnd", params: { kind: "keyRejected", provider: "anthropic" } })).toBe(
      "Anthropic API rechazó la clave de API — revísala en Ajustes.",
    );
  });

  it("pluralizes counts and caps samples", () => {
    expect(textIn("ru", { code: "history.payoff", params: { resolved: 47, total: 77, duplicates: 4 } })).toBe(
      "47 из 77 определено по твоей истории · 4 дубликата",
    );
    expect(
      textIn("en", {
        code: "normalize.skipRules",
        params: { file: "bank.csv", sample: { items: ["Opening balance", "Total"], more: 2 }, held: 3 },
      }),
    ).toBe(
      '4 rows matched skip rules in bank.csv: "Opening balance", "Total" (+2 more) — 3 with an amount left unselected in the preview',
    );
  });

  it("lists the files read in the locale's list style", () => {
    expect(textIn("pt", { code: "reading.files", params: { files: ["a.csv", "b.csv"] } })).toBe(
      "2 arquivos lidos: a.csv e b.csv.",
    );
  });
});
