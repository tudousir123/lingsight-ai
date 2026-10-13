import { BarChart3, ClipboardList, FlaskConical, Users } from "lucide-react"

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
  { icon: ClipboardList, title: "分析任务", path: "/prepare" },
  { icon: BarChart3, title: "统计与报告", path: "/reports" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()

  const items = currentUser?.is_superuser
    ? [...baseItems, { icon: Users, title: "用户管理", path: "/admin" }]
    : baseItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <div className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><FlaskConical className="size-5"/></span><div className="group-data-[collapsible=icon]:hidden"><strong className="text-base text-slate-900">LingSight AI</strong><div className="text-xs tracking-widest text-muted-foreground">灵视科技</div></div></div>
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
