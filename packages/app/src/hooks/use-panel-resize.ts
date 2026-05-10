/**
 * Hook for a horizontally resizable panel anchored to the right edge
 * of the viewport. Width is dragged from a left-edge handle, persisted
 * to localStorage, and clamped to [min, computed-max].
 *
 * The max bound is computed lazily at drag time (`maxWidth(window)`) so
 * window resizes don't strand a previously-saved width above the new
 * max — clamping happens whenever the width is read or written.
 *
 * Pointer events use capture so the drag survives the cursor leaving
 * the handle. The handle is intentionally a thin strip; the visible
 * highlight lives in the consumer's CSS.
 *
 * Companion `useMediaQuery` lives here so consumers can gate the
 * resize UI behind a breakpoint without pulling in another import.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

/**
 * Subscribes to a CSS media query via `useSyncExternalStore`. Returns
 * true when the query matches, false otherwise (and during SSR).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === "undefined") return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener("change", notify)
      return () => mql.removeEventListener("change", notify)
    },
    [query],
  )
  const getSnapshot = useCallback(() => {
    return typeof window !== "undefined" && window.matchMedia(query).matches
  }, [query])
  const getServerSnapshot = useCallback(() => false, [])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export interface PanelResizeOptions {
  /** Minimum width in px. Drags below this snap to min. */
  minWidth: number
  /** Computes the upper bound from the current window. */
  maxWidth: (win: Window) => number
  /** localStorage key under which the width is persisted. */
  storageKey: string
}

export interface PanelResizeReturn {
  /** Current panel width in px (clamped to [min, max]). */
  width: number
  /** True while a pointer drag is in progress. */
  isDragging: boolean
  /** Pass to the drag handle's onPointerDown. */
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

function loadInitialWidth(opts: PanelResizeOptions): number {
  if (typeof window === "undefined") return opts.minWidth
  const raw = window.localStorage.getItem(opts.storageKey)
  const parsed = raw ? Number.parseFloat(raw) : NaN
  if (!Number.isFinite(parsed)) return opts.minWidth
  return clamp(parsed, opts.minWidth, opts.maxWidth(window))
}

type Handler = (e: PointerEvent) => void
type DragRefs = {
  move: Handler
  up: Handler
  forwardMove: Handler
  forwardUp: Handler
}

function makeDragRefs(): DragRefs {
  const refs: DragRefs = {
    move: () => {},
    up: () => {},
    forwardMove: (e) => refs.move(e),
    forwardUp: (e) => refs.up(e),
  }
  return refs
}

export function usePanelResize(opts: PanelResizeOptions): PanelResizeReturn {
  const [width, setWidth] = useState<number>(() => loadInitialWidth(opts))
  const [isDragging, setIsDragging] = useState(false)

  // Drag state lives in refs — pointer callbacks fire on every pixel
  // and React state updates here would just be noise.
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  // The pointer move/up handlers reference each other (down →
  // register move/up; up → unregister both). We store live handlers
  // and stable forwarders in a single ref initialized via useRef's
  // factory form so we never read or write the ref during render.
  const dragRefsRef = useRef<DragRefs>(makeDragRefs())

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault()
      const target = e.currentTarget
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        /* not all environments support pointer capture; carry on */
      }
      dragStartXRef.current = e.clientX
      dragStartWidthRef.current = width
      setIsDragging(true)

      const refs = dragRefsRef.current
      refs.move = (ev) => {
        const o = optsRef.current
        // The handle sits on the LEFT edge of a right-anchored
        // panel — dragging left grows the panel, dragging right
        // shrinks it.
        const delta = dragStartXRef.current - ev.clientX
        const next = clamp(
          dragStartWidthRef.current + delta,
          o.minWidth,
          o.maxWidth(window),
        )
        setWidth(next)
      }
      refs.up = (ev) => {
        const releaseTarget = ev.target as Element | null
        if (releaseTarget && "releasePointerCapture" in releaseTarget) {
          try {
            ;(releaseTarget as Element & {
              releasePointerCapture: (id: number) => void
            }).releasePointerCapture(ev.pointerId)
          } catch {
            /* capture may have been auto-released; ignore */
          }
        }
        window.removeEventListener("pointermove", refs.forwardMove)
        window.removeEventListener("pointerup", refs.forwardUp)
        setIsDragging(false)

        // Persist the committed width. Reading via the setter
        // avoids stale closures.
        setWidth((current) => {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              optsRef.current.storageKey,
              String(current),
            )
          }
          return current
        })
      }

      window.addEventListener("pointermove", refs.forwardMove)
      window.addEventListener("pointerup", refs.forwardUp)
    },
    [width],
  )

  // Cleanup on unmount in case a drag is still active.
  useEffect(() => {
    const refs = dragRefsRef.current
    return () => {
      window.removeEventListener("pointermove", refs.forwardMove)
      window.removeEventListener("pointerup", refs.forwardUp)
    }
  }, [])

  return { width, isDragging, onPointerDown }
}
