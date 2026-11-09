import {
  BarChart3,
  ClipboardList,
  FlaskConical,
  MessageCircleQuestion,
  ScanLine,
  Users,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"

const baseItems: Item[] = [
  { icon: FlaskConical, title: "实验管理", path: "/" },
  { icon: MessageCircleQuestion, title: "科研问答", path: "/qa" },
  { icon: ClipboardList, title: "分析任务", path: "/prepare" },
  { icon: BarChart3, title: "统计与报告", path: "/reports" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const items = currentUser?.is_superuser
    ? [...baseItems, { icon: Users, title: "用户管理", path: "/admin" }]
    : baseItems

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      <SidebarHeader className="px-3 pb-4 pt-6 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <a href="/welcome" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 focus-visible:outline-offset-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-[#393939] bg-[#292929] text-foreground">
            <ScanLine className="size-[18px]" strokeWidth={1.6} />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block text-[16px] font-medium tracking-tight text-foreground">LingSight</span>
            <span className="mt-0.5 block text-[10px] tracking-[.15em] text-muted-foreground">SCIENCE</span>
          </span>
        </a>
        <div className="mx-2 mt-5 border-t border-border pt-4 text-[10px] tracking-[.13em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          RESEARCH WORKSPACE
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2">
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter className="gap-2 border-t border-border p-3">
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
