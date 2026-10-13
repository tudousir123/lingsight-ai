import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router"

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
      throw redirect({
        to: "/login",
      })
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {!isLocalVideoFlow && <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <span className="text-sm font-medium text-slate-700">LingSight AI · 水迷宫</span>
          <span className="ml-auto text-xs text-muted-foreground">科研行为分析</span>
        </header>}
        <main className={isLocalVideoFlow ? "flex-1 bg-slate-50 px-4 py-3 md:px-7 md:py-4" : "flex-1 bg-slate-50 p-4 md:p-7"}>
          <div className="mx-auto max-w-screen-2xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
