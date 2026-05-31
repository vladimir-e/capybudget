import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ModelField, type ModelOption } from "./model-field"

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

  it("opens in custom mode when the saved model is not in the list", () => {
    render(
      <ModelField
        id="m"
        model="gamma-custom"
        onSaveModel={vi.fn()}
        models={MODELS}
      />,
    )
    const input = screen.getByPlaceholderText("model-identifier") as HTMLInputElement
    expect(input.value).toBe("gamma-custom")
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
