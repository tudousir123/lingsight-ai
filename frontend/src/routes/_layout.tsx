import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router"
import { CircleDot } from "lucide-react"

import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async ({ location }) => {
    const isDemoPreview =
      import.meta.env.DEV &&
      import.meta.env.VITE_DEMO_PREVIEW === "true" &&
      ["/", "/prepare", "/results", "/reports"].includes(location.pathname)

    if (!isLoggedIn() && !isDemoPreview) {
      throw redirect({ to: "/login" })
    }
  },
})

function Layout() {
  const pathname = useLocation().pathname
  const isLocalVideoFlow =
    import.meta.env.DEV &&
    import.meta.env.VITE_DEMO_PREVIEW === "true" &&
    import.meta.env.VITE_HEALTHAD_SAMPLE === "true" &&
    (pathname === "/prepare" || pathname === "/results")

  return (
    <SidebarProvider className="lingsight-app">
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 overflow-hidden">
        {!isLocalVideoFlow && (
          <header className="z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
            <SidebarTrigger className="-ml-1 text-muted-foreground" />
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <span className="truncate text-[13px] font-normal tracking-tight text-foreground">
              LingSight <span className="text-muted-foreground">/</span> 水迷宫分析
            </span>
            <span className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground sm:inline-flex">
              <CircleDot className="size-3 text-[#fa5f29]" />
              科研工作台
            </span>
            <a href="/welcome" className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              产品主页
            </a>
          </header>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-4 py-4 lg:px-6 lg:py-5">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
