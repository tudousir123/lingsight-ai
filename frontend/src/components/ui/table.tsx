import * as React from "react"

import { cn } from "@/lib/utils"

/** Horizontal overflow of a scroll container, and whether more is to the right. */
function useHorizontalOverflow() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState({ overflow: false, more: false })
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const hidden = element.scrollWidth - element.clientWidth
      const next = {
        overflow: hidden > 1,
        more: hidden - element.scrollLeft > 1,
      }
      setState((previous) =>
        previous.overflow === next.overflow && previous.more === next.more
          ? previous
          : next,
      )
    }
    update()
    element.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => {
      element.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [])
  return { ref, ...state }
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const { ref, overflow, more } = useHorizontalOverflow()
  return (
    <div>
      {overflow && (
        <p
          data-slot="table-scroll-hint"
          className="mb-2 text-right text-xs text-muted-foreground"
        >
          表格较宽，可左右滑动查看全部列
        </p>
      )}
      <div className="relative">
        <div
          ref={ref}
          data-slot="table-container"
          className="relative w-full overflow-x-auto rounded-lg border"
        >
          <table
            data-slot="table"
            className={cn("w-full caption-bottom text-sm", className)}
            {...props}
          />
        </div>
        {more && (
          <div
            aria-hidden="true"
            data-slot="table-scroll-shadow"
            className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-lg bg-gradient-to-l from-card to-transparent"
          />
        )}
      </div>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/50 [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
