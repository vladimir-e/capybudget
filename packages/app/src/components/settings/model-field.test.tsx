import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ModelField } from "./model-field"
import type { ModelOption } from "@capybudget/intelligence"

const MODELS: ModelOption[] = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
]

afterEach(cleanup)

describe("ModelField", () => {
  it("shows the dropdown (not the custom field) for a model in the list", () => {
    render(
      <ModelField id="m" model="alpha" onSaveModel={vi.fn()} models={MODELS} />,
    )
    // Dropdown mode: the select trigger is present, the custom text field is not.
    expect(screen.getByLabelText("Model")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("model-identifier")).not.toBeInTheDocument()
  })

  it("keeps a saved model the list lacks selected in the dropdown", async () => {
    const user = userEvent.setup()
    render(
      <ModelField
        id="m"
        model="gamma-custom"
        onSaveModel={vi.fn()}
        models={MODELS}
      />,
    )
    expect(screen.getByRole("combobox")).toHaveTextContent("gamma-custom")
    expect(screen.queryByPlaceholderText("model-identifier")).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("Model"))
    expect(await screen.findAllByRole("option")).toHaveLength(3)
  })

  it("adds no extra option for a listed or empty model", async () => {
    const user = userEvent.setup()
    render(<ModelField id="m" model="" onSaveModel={vi.fn()} models={MODELS} />)
    await user.click(screen.getByLabelText("Model"))
    expect(await screen.findAllByRole("option")).toHaveLength(2)
  })

  it("freeText swaps in a plain field with no toggle", () => {
    render(<ModelField id="m" model="qwen" onSaveModel={vi.fn()} models={[]} freeText />)
    expect(screen.queryByLabelText("Use a custom model")).not.toBeInTheDocument()
    expect((screen.getByPlaceholderText("model-identifier") as HTMLInputElement).value).toBe("qwen")
  })

  it("toggling custom mode reveals a free-text field", async () => {
    const user = userEvent.setup()
    render(
      <ModelField id="m" model="alpha" onSaveModel={vi.fn()} models={MODELS} />,
    )
    await user.click(screen.getByLabelText("Use a custom model"))
    expect(screen.getByPlaceholderText("model-identifier")).toBeInTheDocument()
  })

  it("writes custom-field edits through onSaveModel", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ModelField id="m" model="" onSaveModel={onSave} models={MODELS} />,
    )
    await user.click(screen.getByLabelText("Use a custom model"))
    await user.type(screen.getByPlaceholderText("model-identifier"), "x")
    expect(onSave).toHaveBeenCalledWith("x")
  })
})
