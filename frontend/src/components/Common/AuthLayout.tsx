import { ArrowUpRight } from "lucide-react"
import { Appearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import { Footer } from "./Footer"

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r bg-card p-12 lg:flex xl:p-16">
        <Logo />
        <div className="relative z-10 max-w-lg py-20">
          <p className="mb-6 text-xs tracking-[.2em] text-muted-foreground">
            ANIMAL BEHAVIOR RESEARCH
          </p>
          <h2 className="text-4xl leading-snug font-normal tracking-tight xl:text-5xl">
            From behavior,
            <br />
            to evidence.
          </h2>
          <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground">
            Connect videos, trajectories, and analysis. Review trials, inspect
            materials, and trace every research question to its source.
          </p>
          <div className="mt-10 inline-flex items-center gap-3 border-t pt-5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" />
            Water maze · Behavior research workspace
            <ArrowUpRight className="size-4" />
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -bottom-40 size-[560px] rounded-full border border-border p-16"
        >
          <div className="size-full rounded-full border border-border p-16">
            <div className="size-full rounded-full border border-brand/20" />
          </div>
        </div>
        <p className="text-xs tracking-[.15em] text-muted-foreground">
          OBSERVE / REVIEW / UNDERSTAND
        </p>
      </aside>
      <div className="flex min-w-0 flex-col gap-8 p-6 md:p-10">
        <div className="flex items-center justify-between">
          <div className="lg:invisible">
            <Logo />
          </div>
          <Appearance />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 sm:p-8">
            {children}
          </div>
        </div>
        <Footer />
      </div>
    </div>
  )
}
