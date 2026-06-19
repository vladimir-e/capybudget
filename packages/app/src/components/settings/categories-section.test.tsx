import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Category } from "@capybudget/core";
import { makeCategory } from "@/test/factories";
import { CategoriesSection } from "./categories-section";

// The section reads categories from the budget-data hook and renders the live
// category-management surface. Mock the data + mutation layers so it mounts
// without a QueryClient — we're asserting the management UI, not mutations.
let mockCategories: Category[] = [];

vi.mock("@/hooks/use-budget-data", () => ({
  useCategories: () => ({ data: mockCategories }),
}));

vi.mock("@/hooks/use-category-mutations", () => ({
  useCreateCategory: () => ({ mutate: vi.fn() }),
  useUpdateCategory: () => ({ mutate: vi.fn() }),
  useDeleteCategory: () => ({ mutate: vi.fn() }),
  useArchiveCategory: () => ({ mutate: vi.fn() }),
  useUnarchiveCategory: () => ({ mutate: vi.fn() }),
  useReorderCategoryDnd: () => ({ mutate: vi.fn() }),
}));

const groceries = makeCategory({ id: "cat-g", name: "Groceries", group: "Daily Living" });
const housing = makeCategory({ id: "cat-h", name: "Housing", group: "Fixed" });

beforeEach(() => {
  mockCategories = [groceries, housing];
});

afterEach(() => {
  cleanup();
});

describe("CategoriesSection", () => {
  it("renders seeded categories under their groups with the add-group entry point", () => {
    render(<CategoriesSection />);

    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Daily Living")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Group" })).toBeInTheDocument();
  });
});
