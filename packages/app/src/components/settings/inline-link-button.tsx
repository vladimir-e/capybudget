import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function InlineLinkButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "rounded-sm underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        className,
      )}
      {...props}
    />
  )
}
