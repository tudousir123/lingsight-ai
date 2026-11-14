import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0">
        <p className="mb-3 text-[10px] tracking-[.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions}
    </div>
  )
}
