import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLocale } from "./locales";

// config.ts resolves the initial locale at module-eval, so each case reimports
// the module fresh under a different navigator/localStorage stub to drive that
// boot path. We assert on both projections: i18n.language (the full BCP-47
// format tag) and i18n.resolvedLanguage (the collapsed catalog language).
async function boot(): Promise<{ format: string; language: string }> {
  vi.resetModules();
  const { i18n } = await import("./config");
  return {
    format: i18n.language,
    language: normalizeLocale(i18n.resolvedLanguage ?? i18n.language),
  };
}

describe("i18n boot-path locale detection", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "localStorage",
  );

  function stubLocalStorage(value: Storage) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value,
    });
  }

  function noStorage() {
    stubLocalStorage({ getItem: () => null } as unknown as Storage);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
  });

  it("keeps a supported region tag whole as the format locale", async () => {
    noStorage();
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(await boot()).toEqual({ format: "en-GB", language: "en" });
  });

  it("keeps the region for a non-English supported language", async () => {
    noStorage();
    vi.stubGlobal("navigator", { language: "ru-RU" });
    expect(await boot()).toEqual({ format: "ru-RU", language: "ru" });
  });

  it("gates an unsupported language to the default, dropping its region", async () => {
    noStorage();
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(await boot()).toEqual({ format: "en", language: "en" });
  });

  it("honors a legacy bare stored code (no region)", async () => {
    stubLocalStorage({ getItem: () => "ru" } as unknown as Storage);
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(await boot()).toEqual({ format: "ru", language: "ru" });
  });

  it("honors a stored full region tag", async () => {
    stubLocalStorage({ getItem: () => "en-GB" } as unknown as Storage);
    vi.stubGlobal("navigator", { language: "ru-RU" });
    expect(await boot()).toEqual({ format: "en-GB", language: "en" });
  });

  it("falls back to navigator detection when the read throws", async () => {
    stubLocalStorage({
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as Storage);
    vi.stubGlobal("navigator", { language: "ru-RU" });
    expect(await boot()).toEqual({ format: "ru-RU", language: "ru" });
  });
});
