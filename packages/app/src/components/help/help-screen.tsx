import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { Button } from "@/components/ui/button"
import {
  HELP_INTRO,
  HELP_SECTIONS,
  HELP_TITLE,
  type HelpBlock,
} from "./help-guide-content"

declare const __IS_DEMO__: boolean

const DEMO_URL = "https://demo.capybudget.app"

export function HelpScreen() {
  const navigate = useNavigate()
  const { path, name } = useSearch({ from: "/budget" })
  const scrollRef = useRef<HTMLElement>(null)
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0]?.id ?? "")

  const handleBack = useCallback(() => {
    navigate({ to: "/budget", search: { path, name } })
  }, [navigate, path, name])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        handleBack()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [handleBack])

  // Scroll-spy: the topmost section whose heading sits within the upper band of
  // the scroll viewport wins. Observing against the scroll root (not the
  // viewport) keeps it correct inside this independently-scrolled pane.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const headings = HELP_SECTIONS.map((s) =>
      root.querySelector<HTMLElement>(`#${s.id}`),
    ).filter((el): el is HTMLElement => el !== null)
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [])

  function scrollToSection(id: string) {
    setActiveId(id)
    scrollRef.current
      ?.querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    // Pin to the viewport so the content pane scrolls, not the page — matches
    // SettingsScreen. The min width keeps the demo usable on a phone.
    <div className="h-screen overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-[48rem]">
        <nav
          aria-label="Help sections"
          className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
        >
          <div className="flex items-center gap-2 px-3 py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Back to budget"
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-base font-bold tracking-tight">Help</h2>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {HELP_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(section.id)}
                aria-current={activeId === section.id ? "true" : undefined}
                className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeId === section.id
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                {section.title}
              </button>
            ))}
          </div>
        </nav>

        <main ref={scrollRef} className="flex-1 overflow-y-auto" tabIndex={-1}>
          <article className="mx-auto w-full max-w-2xl px-6 py-10 leading-relaxed">
            <h1 className="text-2xl font-bold tracking-tight">{HELP_TITLE}</h1>
            <p className="mt-3 text-muted-foreground">{HELP_INTRO}</p>

            {!__IS_DEMO__ && (
              <button
                type="button"
                onClick={() => void shellOpen(DEMO_URL)}
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-brand transition-colors hover:text-brand/80"
              >
                Prefer to poke around first? Try the live demo
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}

            {HELP_SECTIONS.map((section) => (
              <section key={section.id} className="mt-10">
                <h2
                  id={section.id}
                  className="scroll-mt-6 text-lg font-semibold tracking-tight"
                >
                  {section.title}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.blocks.map((block, i) => (
                    <Block key={i} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </article>
        </main>
      </div>
    </div>
  )
}

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === "list") {
    return (
      <ul className="space-y-1.5 pl-1">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/90">
            <span aria-hidden className="select-none text-muted-foreground">
              •
            </span>
            <span>
              {item.term && (
                <span className="font-semibold text-foreground">{item.term}</span>
              )}
              {item.term ? " — " : ""}
              <Inline text={item.text} />
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <p className="text-sm text-foreground/90">
      <Inline text={block.text} />
    </p>
  )
}

/** Renders `**bold**` spans; everything else is plain text. Bold is not
 *  nestable — the guide copy never needs it. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <span key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
