import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export type Item = {
  icon: LucideIcon
  title: string
  path: string
  preview?: boolean
}

interface MainProps {
  items: Item[]
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouterState()
  const currentPath = router.location.pathname

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarGroup className="p-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {items.map((item) => {
            const isActive =
              currentPath === item.path ||
              (item.path === "/annotations" &&
                currentPath.startsWith("/experiments/"))

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  className="research-nav-link"
                  isActive={isActive}
                  asChild
                >
                  <RouterLink
                    to={item.path}
                    onClick={handleMenuClick}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <item.icon className="size-[17px]" strokeWidth={1.65} />
                    <span className="flex-1">{item.title}</span>
                    {item.preview && (
                      <span className="rounded border border-border px-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                        Preview
                      </span>
                    )}
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
