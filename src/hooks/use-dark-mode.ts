import { useEffect } from "react";

export function useDarkMode() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply(dark: boolean) {
      document.documentElement.classList.toggle("dark", dark);
    }

    apply(mq.matches);
    mq.addEventListener("change", (e) => apply(e.matches));
    return () => mq.removeEventListener("change", (e) => apply(e.matches));
  }, []);
}
