import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePanelResize } from "./use-panel-resize"

const STORAGE_KEY = "capy-panel-width"
const MIN = 440
const MAX = (win: Window): number => Math.min(win.innerWidth, 720)

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe("usePanelResize", () => {
  it("seeds from localStorage when a value is present and valid", () => {
    window.localStorage.setItem(STORAGE_KEY, "560")
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(560)
  })

  it("clamps a stored value above max down to max", () => {
    window.localStorage.setItem(STORAGE_KEY, "9999")
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(720)
  })

  it("clamps a stored value below min up to min", () => {
    window.localStorage.setItem(STORAGE_KEY, "100")
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(MIN)
  })

  it("falls back to min when no value is stored", () => {
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(MIN)
  })

  it("falls back to min when stored value is non-numeric", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-number")
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(MIN)
  })

  it("persists the width to localStorage on pointerup", () => {
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )

    // Simulate a drag: pointerdown at clientX=1000, then pointermove
    // at clientX=900 (drag left → grow by 100), then pointerup.
    const handle = document.createElement("div")
    document.body.appendChild(handle)

    act(() => {
      result.current.onPointerDown({
        clientX: 1000,
        pointerId: 1,
        currentTarget: handle,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 900, pointerId: 1 }),
      )
    })

    expect(result.current.width).toBe(540) // 440 + (1000 - 900)

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 900, pointerId: 1 }),
      )
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("540")
    expect(result.current.isDragging).toBe(false)

    handle.remove()
  })

  it("snaps to min when drag would take width below min", () => {
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )

    const handle = document.createElement("div")
    document.body.appendChild(handle)

    act(() => {
      result.current.onPointerDown({
        clientX: 1000,
        pointerId: 1,
        currentTarget: handle,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    // Drag 1000px to the right — would yield -560, clamps to MIN.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 2000, pointerId: 1 }),
      )
    })

    expect(result.current.width).toBe(MIN)

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }))
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(MIN))
    handle.remove()
  })

  it("clamps to max when drag would exceed max", () => {
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )

    const handle = document.createElement("div")
    document.body.appendChild(handle)

    act(() => {
      result.current.onPointerDown({
        clientX: 1000,
        pointerId: 1,
        currentTarget: handle,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    // Drag 1000px to the left — would yield 1440, clamps to 720.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, pointerId: 1 }),
      )
    })

    expect(result.current.width).toBe(720)

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }))
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("720")
    handle.remove()
  })

  it("re-clamps the width when the window shrinks below the saved max", () => {
    // Seed a width that fits the current viewport but exceeds a smaller
    // future window.
    window.localStorage.setItem(STORAGE_KEY, "700")
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.width).toBe(700)

    const originalInnerWidth = window.innerWidth
    try {
      // Shrink the window so the new max is below 700, then fire resize.
      act(() => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: 600,
        })
        window.dispatchEvent(new Event("resize"))
      })

      // MAX(window) = min(600, 720) = 600 → width clamps down.
      expect(result.current.width).toBe(600)
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: originalInnerWidth,
      })
    }
  })

  it("isDragging is true during a drag", () => {
    const { result } = renderHook(() =>
      usePanelResize({ minWidth: MIN, maxWidth: MAX, storageKey: STORAGE_KEY }),
    )
    expect(result.current.isDragging).toBe(false)

    const handle = document.createElement("div")
    document.body.appendChild(handle)

    act(() => {
      result.current.onPointerDown({
        clientX: 1000,
        pointerId: 1,
        currentTarget: handle,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLElement>)
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }))
    })
    expect(result.current.isDragging).toBe(false)

    handle.remove()
  })
})
