import { describe, it, expect, beforeEach, vi } from "vitest";

const { sonnerBase, sonnerError, sonnerSuccess } = vi.hoisted(() => ({
  sonnerBase: vi.fn(),
  sonnerError: vi.fn(),
  sonnerSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => sonnerBase(...args), {
    error: (...args: unknown[]) => sonnerError(...args),
    success: (...args: unknown[]) => sonnerSuccess(...args),
  }),
}));

import { toast } from "./toast";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toast wrapper", () => {
  it("makes error toasts persist by default (duration: Infinity)", () => {
    toast.error("boom");
    expect(sonnerError).toHaveBeenCalledWith("boom", { duration: Infinity });
  });

  it("lets a caller-supplied finite duration win over the default", () => {
    toast.error("boom", { duration: 3000 });
    expect(sonnerError).toHaveBeenCalledWith("boom", { duration: 3000 });
  });

  it("keeps other options while applying the default duration", () => {
    toast.error("boom", { description: "details" });
    expect(sonnerError).toHaveBeenCalledWith("boom", {
      duration: Infinity,
      description: "details",
    });
  });

  it("forwards non-error methods to sonner untouched", () => {
    toast.success("saved");
    expect(sonnerSuccess).toHaveBeenCalledWith("saved");
    expect(sonnerError).not.toHaveBeenCalled();
  });
});
