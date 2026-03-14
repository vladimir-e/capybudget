import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedWriter } from "./debounced-writer";

describe("createDebouncedWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call fn immediately on schedule", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createDebouncedWriter(fn, 300);
    writer.schedule();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn after delay", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createDebouncedWriter(fn, 300);
    writer.schedule();
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("debounces multiple rapid calls", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createDebouncedWriter(fn, 300);
    writer.schedule();
    vi.advanceTimersByTime(100);
    writer.schedule();
    vi.advanceTimersByTime(100);
    writer.schedule();
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("flush calls fn immediately and clears timer", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createDebouncedWriter(fn, 300);
    writer.schedule();
    await writer.flush();
    expect(fn).toHaveBeenCalledOnce();
    // Advancing time should not cause a second call
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("flush is safe when nothing is scheduled", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createDebouncedWriter(fn, 300);
    await writer.flush();
    expect(fn).toHaveBeenCalledOnce();
  });
});
