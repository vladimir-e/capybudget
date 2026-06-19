import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts resolves the initial locale at module-eval, so each case reimports
// the module fresh under a different localStorage stub to drive that boot path.
async function bootLocale(): Promise<string> {
  vi.resetModules();
  const { i18n } = await import("./config");
  return i18n.language;
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

  beforeEach(() => {
    vi.stubGlobal("navigator", { language: "ru-RU" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
  });

  it("uses the stored preference when localStorage works", async () => {
    stubLocalStorage({
      getItem: () => "en",
    } as unknown as Storage);
    expect(await bootLocale()).toBe("en");
  });

  it("falls back to navigator detection when the read throws", async () => {
    stubLocalStorage({
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as Storage);
    expect(await bootLocale()).toBe("ru");
  });
});
