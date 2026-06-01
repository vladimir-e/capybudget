import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmptyState } from "./empty-state";

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("omits the description when not provided", () => {
    render(<EmptyState title="Title only" />);
    expect(screen.queryByText("a description")).not.toBeInTheDocument();
  });

  it("renders an icon, description, and action when provided", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="Title"
        description="Some context"
        action={<button>Do it</button>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Some context")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });

  it("treats children as the action slot", () => {
    render(
      <EmptyState title="Title">
        <button>From children</button>
      </EmptyState>,
    );
    expect(screen.getByRole("button", { name: "From children" })).toBeInTheDocument();
  });
});
