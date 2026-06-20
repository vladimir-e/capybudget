import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "./config";
import { useFormatLocale, useLocale } from "./hooks";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("useLocale / useFormatLocale", () => {
  it("splits the catalog language from the full format tag", async () => {
    await act(async () => {
      await i18n.changeLanguage("en-GB");
    });
    const language = renderHook(() => useLocale());
    const format = renderHook(() => useFormatLocale());
    expect(language.result.current).toBe("en");
    expect(format.result.current).toBe("en-GB");
  });

  it("both react to a language switch", async () => {
    const language = renderHook(() => useLocale());
    const format = renderHook(() => useFormatLocale());
    expect(language.result.current).toBe("en");
    expect(format.result.current).toBe("en");

    await act(async () => {
      await i18n.changeLanguage("ru-RU");
    });
    language.rerender();
    format.rerender();
    expect(language.result.current).toBe("ru");
    expect(format.result.current).toBe("ru-RU");
  });
});
