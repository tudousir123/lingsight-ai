import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
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

const sectionTitles: Record<string, string> = {
  admin: "用户管理",
  analysis: "分析与报告",
  annotations: "视频与标注",
  experiments: "实验与数据",
  inference: "视频推理",
  "project-research": "项目研究",
  projects: "项目",
  settings: "工作区设置",
  tasks: "科研任务",
}

function Layout() {
  const pathname = useLocation().pathname
  const section = pathname.split("/")[1]
  const title = sectionTitles[section]
  const isAgentWorkspace =
    !section ||
    section === "tasks" ||
    section === "projects" ||
    section === "project-research"

  return (
    <SidebarProvider
      className="lingsight-app agent-shell dark"
      style={{ "--sidebar-width": "236px" } as CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
        <header className="agent-shell-header">
          <SidebarTrigger />
          <nav className="agent-shell-path" aria-label="当前位置">
            {title ? (
              <>
                <Link to="/">工作台</Link>
                <ChevronRight size={14} aria-hidden="true" />
                <span aria-current="page">{title}</span>
              </>
            ) : (
              <span aria-current="page">工作台</span>
            )}
          </nav>
          <Link to="/onboarding" className="agent-guide-link">
            研究指南
          </Link>
        </header>
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
