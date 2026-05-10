import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { formatText } from "./format-text"

afterEach(() => {
  cleanup()
})

function rendered(text: string) {
  return render(<div data-testid="root">{formatText(text)}</div>).getByTestId("root")
}

describe("formatText — basic markdown", () => {
  it("renders plain text unchanged", () => {
    const root = rendered("Hello world.")
    expect(root.textContent).toBe("Hello world.")
    expect(root.querySelectorAll("strong").length).toBe(0)
    expect(root.querySelectorAll("em").length).toBe(0)
  })

  it("renders **bold** as a <strong> element", () => {
    const root = rendered("This is **bold** text.")
    const strongs = root.querySelectorAll("strong")
    expect(strongs.length).toBe(1)
    expect(strongs[0].textContent).toBe("bold")
  })

  it("renders *italic* as an <em> element", () => {
    const root = rendered("This is *italic* text.")
    const ems = root.querySelectorAll("em")
    expect(ems.length).toBe(1)
    expect(ems[0].textContent).toBe("italic")
  })

  it("renders mixed bold and italic in the same string", () => {
    const root = rendered("**bold** and *italic*")
    expect(root.querySelectorAll("strong").length).toBe(1)
    expect(root.querySelectorAll("em").length).toBe(1)
    expect(root.querySelector("strong")?.textContent).toBe("bold")
    expect(root.querySelector("em")?.textContent).toBe("italic")
  })

  it("does not greedily merge two **bold** spans", () => {
    const root = rendered("**foo**bar**baz**")
    const strongs = root.querySelectorAll("strong")
    expect(strongs.length).toBe(2)
    expect(strongs[0].textContent).toBe("foo")
    expect(strongs[1].textContent).toBe("baz")
  })

  it("leaves trailing ** as literal text", () => {
    const root = rendered("Some **bold** then dangling **")
    expect(root.querySelectorAll("strong").length).toBe(1)
    expect(root.textContent).toBe("Some bold then dangling **")
  })
})

describe("formatText — money detection", () => {
  it("applies the brand color class to dollar amounts", () => {
    const root = rendered("You spent **$1,234.56** this month.")
    const strong = root.querySelector("strong")
    expect(strong?.textContent).toBe("$1,234.56")
    expect(strong?.className).toContain("text-brand")
  })

  it("applies the brand color class to percentages", () => {
    const root = rendered("Up **32%** from last month.")
    const strong = root.querySelector("strong")
    expect(strong?.textContent).toBe("32%")
    expect(strong?.className).toContain("text-brand")
  })

  it("applies the brand color class to per-period figures", () => {
    const root = rendered("Saving **$2,941/mo** averaged.")
    const strong = root.querySelector("strong")
    expect(strong?.textContent).toBe("$2,941/mo")
    expect(strong?.className).toContain("text-brand")
  })

  it("does not apply the brand color to non-money bolded text", () => {
    const root = rendered("This is **food** spending.")
    const strong = root.querySelector("strong")
    expect(strong?.textContent).toBe("food")
    expect(strong?.className).not.toContain("text-brand")
  })

  it("renders mixed money + non-money bolded spans correctly", () => {
    const root = rendered("You spent **$1,234** in **food**.")
    const strongs = root.querySelectorAll("strong")
    expect(strongs.length).toBe(2)
    expect(strongs[0].textContent).toBe("$1,234")
    expect(strongs[0].className).toContain("text-brand")
    expect(strongs[1].textContent).toBe("food")
    expect(strongs[1].className).not.toContain("text-brand")
  })

  it("treats bare numbers without a unit as not money", () => {
    const root = rendered("There are **42** transactions.")
    const strong = root.querySelector("strong")
    expect(strong?.className).not.toContain("text-brand")
  })

  it("treats multipliers like 2.5x as money", () => {
    const root = rendered("That's **2.5x** the usual.")
    const strong = root.querySelector("strong")
    expect(strong?.className).toContain("text-brand")
  })
})
