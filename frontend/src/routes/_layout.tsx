import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { ChartNoAxesCombined, CircleDot, MessageSquare } from "lucide-react"

import type { CSSProperties } from "react"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import "@/features/agent/workspace.css"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
  },
})

function Layout() {
  const pathname = useLocation().pathname
  const isAgentWorkspace = pathname === "/" || pathname.startsWith("/tasks/")

  return (
    <SidebarProvider
      className="lingsight-app agent-shell dark"
      style={{ "--sidebar-width": "274px" } as CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
        {isAgentWorkspace && (
          <header className="agent-shell-header">
            <SidebarTrigger />
            <span className="agent-top-tab">
              <MessageSquare size={14} />
              科研工作区
            </span>
            <Link to="/analysis" className="agent-top-tab">
              <ChartNoAxesCombined size={14} />
              分析与成果
            </Link>
            <Link to="/onboarding" className="agent-guide-link">
              研究指南
            </Link>
          </header>
        )}
        {!isAgentWorkspace && (
          <header className="z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
            <SidebarTrigger className="-ml-1 text-muted-foreground" />
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <span className="truncate text-[13px] font-normal tracking-tight text-foreground">
              LingSight <span className="text-muted-foreground">/</span>{" "}
              水迷宫研究
            </span>
            <span className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground sm:inline-flex">
              <CircleDot className="size-3 text-brand" />
              科研工作区
            </span>
            <Link
              to="/onboarding"
              className="shrink-0 rounded-full px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              研究指南
            </Link>
            <Link
              to="/welcome"
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              产品首页
            </Link>
          </header>
        )}
        {isAgentWorkspace ? (
          <div className="agent-layout-body">
            <Outlet />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-4 py-4 lg:px-6 lg:py-5">
            <div className="mx-auto w-full max-w-[1600px]">
              <Outlet />
            </div>
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
