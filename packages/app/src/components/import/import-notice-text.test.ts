import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { i18n } from "@capybudget/i18n";
import type { ImportNotice } from "@capybudget/intelligence";
import { importNoticeText } from "./import-notice-text";

function textIn(lng: string, notice: ImportNotice, ollamaBaseUrl = ""): string {
  const t = i18n.getFixedT(lng, ["import", "common"]) as TFunction<["import", "common"]>;
  return importNoticeText(notice, { t, ollamaBaseUrl });
}

function logLineIn(lng: string, notice: ImportNotice): string {
  const t = i18n.getFixedT(lng, ["import", "common"]) as TFunction<["import", "common"]>;
  return importNoticeText(notice, { t, ollamaBaseUrl: "", withDetail: true });
}

const UNUSABLE = { kind: "unusable", detail: 'column "Amount" does not hold amounts' } as const;

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

  it("frames a run failure and never renders a blank one", () => {
    expect(textIn("en", { code: "failed", params: { detail: "disk full" } })).toBe("Import failed — disk full");
    expect(textIn("ru", { code: "failed", params: { detail: "" } })).toBe("Импорт не удался — неизвестная ошибка");
    expect(textIn("en", { code: "normalize.fileSkipped", params: { file: "x.csv", cause: { kind: "other", detail: " " } } })).toBe(
      "Skipped x.csv — unknown error.",
    );
  });

  it("keeps an unusable answer's reason out of the toast", () => {
    expect(textIn("en", { code: "normalize.fileFailed", params: { file: "bank.csv", cause: UNUSABLE } })).toBe(
      "Couldn't import bank.csv — the AI's answer couldn't be turned into transactions.",
    );
  });

  it("appends an unusable answer's reason to log lines", () => {
    const reason = '(column "Amount" does not hold amounts)';
    expect(logLineIn("en", { code: "normalize.fileSkipped", params: { file: "bank.csv", cause: UNUSABLE } })).toBe(
      `Skipped bank.csv — the AI's answer couldn't be turned into transactions ${reason}.`,
    );
    expect(logLineIn("en", { code: "normalize.fileFailed", params: { file: "bank.csv", cause: UNUSABLE } })).toBe(
      `Couldn't import bank.csv — the AI's answer couldn't be turned into transactions ${reason}.`,
    );
    expect(logLineIn("en", { code: "categorize.batchFailed", params: { batch: 1, count: 1, cause: UNUSABLE } })).toBe(
      `Batch 1 failed (1 row left for re-run): the AI's answer couldn't be used ${reason}`,
    );
    expect(logLineIn("en", { code: "categorize.transferBatchFailed", params: { count: 2, cause: UNUSABLE } })).toBe(
      `Transfer batch failed (2 rows left for re-run): the AI's answer couldn't be used ${reason}`,
    );
  });

  it("logs the model's reason for a file with no data", () => {
    const notice = { code: "normalize.noData", params: { file: "selfie.png", detail: "Just a selfie." } } as const;
    expect(logLineIn("en", notice)).toBe("Skipped selfie.png — no transaction data found (Just a selfie.).");
    expect(textIn("en", notice)).toBe("Skipped selfie.png — no transaction data found.");
  });

  it("words a batch run that landed nothing without a cause", () => {
    expect(textIn("en", { code: "categorize.noneLanded", params: { count: 3, cause: null } })).toBe(
      "Capy couldn't categorize any of 3 rows. They're staged — run Enrich to try again.",
    );
  });

  it("says when there is nothing staged to enrich", () => {
    expect(textIn("pt", { code: "enrich.noStaging" })).toBe("Nenhuma transação preparada para enriquecer.");
  });

  it("words a single missing transaction grammatically", () => {
    const notice = { code: "normalize.countMismatch", params: { file: "s.png", counted: 5, returned: 4 } } as const;
    expect(textIn("es", notice)).toBe("s.png: la IA contó 5 transacciones pero devolvió 4 — puede que falten algunas (1).");
    expect(textIn("pt", notice)).toBe("s.png: a IA contou 5 transações, mas retornou 4 — algumas podem estar faltando (1).");
  });
});
