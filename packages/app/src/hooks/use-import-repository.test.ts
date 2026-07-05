import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { exists, remove } from "@tauri-apps/plugin-fs";
import { useImportRepository } from "./use-import-repository";

const mockExists = vi.mocked(exists);
const mockRemove = vi.mocked(remove);

beforeEach(() => {
  vi.clearAllMocks();
  mockRemove.mockResolvedValue(undefined);
});

describe("useImportRepository — clearImportData (authoritative)", () => {
  it("removes the import dir and resolves once it's verifiably gone", async () => {
    mockExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { result } = renderHook(() => useImportRepository("/budget"));

    await expect(result.current.clearImportData()).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith("/budget/.capy/import", { recursive: true });
  });

  it("returns without removing when there's nothing staged", async () => {
    mockExists.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useImportRepository("/budget"));

    await result.current.clearImportData();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("retries once when the first remove leaves the dir behind (shared-mount lag)", async () => {
    mockExists
      .mockResolvedValueOnce(true) // present
      .mockResolvedValueOnce(true) // still present after the first remove
      .mockResolvedValueOnce(false); // gone after the retry
    const { result } = renderHook(() => useImportRepository("/budget"));

    await expect(result.current.clearImportData()).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it("throws when the dir survives the retry, instead of reporting a silent success", async () => {
    mockExists.mockResolvedValue(true); // never gone
    const { result } = renderHook(() => useImportRepository("/budget"));

    await expect(result.current.clearImportData()).rejects.toThrow(/still present/);
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});

describe("useImportRepository — removeSourceFile", () => {
  it("resolves on a successful remove", async () => {
    mockRemove.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useImportRepository("/budget"));
    await expect(result.current.removeSourceFile("a.csv")).resolves.toBeUndefined();
  });

  it("swallows a remove error when the file is already gone", async () => {
    mockRemove.mockRejectedValueOnce(new Error("ENOENT"));
    mockExists.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useImportRepository("/budget"));
    await expect(result.current.removeSourceFile("a.csv")).resolves.toBeUndefined();
  });

  it("rethrows when the remove failed and the file is still on disk", async () => {
    mockRemove.mockRejectedValueOnce(new Error("EPERM"));
    mockExists.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useImportRepository("/budget"));
    await expect(result.current.removeSourceFile("a.csv")).rejects.toThrow(/EPERM/);
  });
});
