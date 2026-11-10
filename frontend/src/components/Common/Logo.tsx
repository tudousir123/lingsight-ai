import { Link } from "@tanstack/react-router"
import { ScanLine } from "lucide-react"
import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-foreground",
        className,
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-accent">
        <ScanLine className="size-[18px]" strokeWidth={1.6} aria-hidden />
      </span>
      {variant !== "icon" && (
        <span
          className={cn(
            "min-w-0",
            variant === "responsive" && "group-data-[collapsible=icon]:hidden",
          )}
        >
          <span className="block text-base font-medium tracking-tight">
            LingSight
          </span>
          <span className="mt-0.5 block text-[10px] tracking-[.18em] text-muted-foreground">
            SCIENCE
          </span>
        </span>
      )}
    </span>
  )
  return asLink ? (
    <Link
      to="/welcome"
      aria-label="LingSight Science product home"
      className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      {content}
    </Link>
  ) : (
    content
  )
}
