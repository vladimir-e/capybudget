import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SourceFileInfo } from "@/hooks/use-import-repository";

// Identity `t` so assertions read against stable keys, not localized copy.
vi.mock("@capybudget/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-formatters", () => ({
  useFormatters: () => ({ date: (s: string) => s }),
}));
vi.mock("@/components/budget/account-selector", () => ({
  AccountSelector: () => <div data-testid="account-selector" />,
}));

import { ImportDropZone } from "./import-drop-zone";

const sourceFiles: SourceFileInfo[] = [{ name: "statement.csv", size: 1024 }];

function renderZone(overrides: Record<string, unknown> = {}) {
  const props = {
    fileInputRef: { current: null },
    onFileSelect: vi.fn(),
    dragging: false,
    onBrowse: vi.fn(),
    sourceFiles,
    uploadingFiles: new Set<string>(),
    fileDuplicates: {},
    onRemoveFile: vi.fn(),
    localInstructions: "",
    onInstructionsChange: vi.fn(),
    onInstructionsBlur: vi.fn(),
    accounts: [],
    selectedAccountId: "",
    onAccountChange: vi.fn(),
    onStart: vi.fn(),
    canStart: true,
    providerIsClaudeCli: false,
    onSetupAi: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ImportDropZone {...(props as any)} />);
}

describe("ImportDropZone — run gate", () => {
  it("shows Start (not the setup CTA) when the import can start", () => {
    renderZone({ canStart: true });

    expect(screen.getByText("dropZone.start")).toBeInTheDocument();
    expect(screen.queryByText("setupAi.button")).toBeNull();
    expect(screen.queryByText("setupAi.title")).toBeNull();
  });

  it("shows the setup CTA (not Start) when the import can't start", () => {
    renderZone({ canStart: false });

    expect(screen.getByText("setupAi.button")).toBeInTheDocument();
    expect(screen.getByText("setupAi.title")).toBeInTheDocument();
    expect(screen.queryByText("dropZone.start")).toBeNull();
  });

  it("uses the generic body for a non-CLI provider", () => {
    renderZone({ canStart: false, providerIsClaudeCli: false });

    expect(screen.getByText("setupAi.body")).toBeInTheDocument();
    expect(screen.queryByText("setupAi.cliBody")).toBeNull();
  });

  it("uses the CLI body when the provider is claude-cli", () => {
    renderZone({ canStart: false, providerIsClaudeCli: true });

    expect(screen.getByText("setupAi.cliBody")).toBeInTheDocument();
    expect(screen.queryByText("setupAi.body")).toBeNull();
  });
});
