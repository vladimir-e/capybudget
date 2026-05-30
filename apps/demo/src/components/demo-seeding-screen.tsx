import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import bgDay from "@/assets/capy-bg-day.webp";
import bgNight from "@/assets/capy-bg-night.webp";

/** Minimum time the seeding screen stays up, in ms. Generation is instant, so we
 *  pace the bar over this floor to make the "seeding random data" beat read as
 *  intentional rather than a flash. */
const SEED_DURATION_MS = 1500;

interface DemoSeedingScreenProps {
  /** Scenario name, shown so the seeding beat feels tied to the chosen profile. */
  name: string;
  /** Fired once the bar reaches 100% and the floor has elapsed. */
  onDone: () => void;
}

export function DemoSeedingScreen({ name, onDone }: DemoSeedingScreenProps) {
  const { theme, resolvedTheme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  // Start at 0, flip to 100 on the next frame so the bar's CSS transition
  // animates the fill across SEED_DURATION_MS instead of jumping.
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setProgress(100));
    const timer = setTimeout(onDone, SEED_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onDone]);

  return (
    <>
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden
      />

      <div className="relative z-0 flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card/85 p-8 shadow-overlay backdrop-blur-md dark:bg-card/70">
          <div className="space-y-1 mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 font-mono">
              {name}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Seeding random data…
            </h1>
            <p className="text-sm text-muted-foreground">
              Made-up numbers, just for you. Poke at anything — nothing here is
              real and nothing is saved.
            </p>
          </div>

          <div
            className="h-2 w-full overflow-hidden rounded-full bg-background/40"
            role="progressbar"
            aria-label="Seeding random data"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] ease-out"
              style={{
                width: `${progress}%`,
                transitionDuration: `${SEED_DURATION_MS}ms`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
