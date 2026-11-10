import { Link, useLocation } from "@tanstack/react-router"
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDot,
  Database,
  FolderOpen,
  MessageSquare,
  Plus,
  ScanLine,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { statusLabels } from "@/features/agent/api"
import { useWorkspaceProjects } from "@/features/agent/projects"
import { useTasks } from "@/features/agent/queries"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"
import "./research-sidebar.css"

const baseItems: Item[] = [
  { icon: Plus, title: "新建科研任务", path: "/" },
  { icon: Database, title: "实验与数据", path: "/experiments" },
  { icon: ScanLine, title: "视频与标注", path: "/annotations" },
  { icon: ChartNoAxesCombined, title: "分析与报告", path: "/analysis" },
]
export function AppSidebar() {
  const { user } = useAuth()
  const tasks = useTasks()
  const projects = useWorkspaceProjects()
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [projectError, setProjectError] = useState("")
  const pathname = useLocation().pathname
  const { isMobile, setOpenMobile, setOpen } = useSidebar()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState("")
  const searchInput = useRef<HTMLInputElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const history = useRef<HTMLDetailsElement>(null)
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  useEffect(() => {
    if (searchOpen) {
      if (history.current) history.current.open = true
      searchInput.current?.focus()
    }
  }, [searchOpen])
  const items = user?.is_superuser
    ? [...baseItems, { icon: Users, title: "用户管理", path: "/admin" }]
    : baseItems
  const recent = tasks.data?.slice(0, 20) ?? []
  const visibleTasks = search.trim()
    ? (tasks.data?.filter((task) =>
        task.title
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ) ?? [])
    : recent

  return (
    <Sidebar collapsible="icon" className="research-sidebar border-0">
      <SidebarHeader className="research-sidebar-header group-data-[collapsible=icon]:px-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="research-sidebar-brand"
            aria-label="灵视科研工作区菜单"
          >
            <ScanLine size={21} strokeWidth={1.5} />
            <span className="research-sidebar-name group-data-[collapsible=icon]:hidden">
              灵视科研
            </span>
            <span className="research-sidebar-plan group-data-[collapsible=icon]:hidden">
              个人
            </span>
            <ChevronDown
              size={13}
              className="research-brand-chevron group-data-[collapsible=icon]:hidden"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="w-60">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              个人科研工作区
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/settings" onClick={close}>
                <Settings size={15} />
                工作区设置
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/onboarding" onClick={close}>
                <ScanLine size={15} />
                研究指南
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/inference" onClick={close}>
                <ScanLine size={15} />
                视频推理
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/welcome" onClick={close}>
                <ArrowUpRight size={15} />
                产品首页
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent className="research-sidebar-content">
        <nav aria-label="科研工作区导航">
          <Main items={items} />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                ref={searchButton}
                className="research-nav-link"
                tooltip="搜索科研任务"
                aria-expanded={searchOpen}
                aria-controls="research-task-search"
                onClick={() => {
                  setOpen(true)
                  if (searchOpen) setSearch("")
                  setSearchOpen((open) => !open)
                }}
              >
                <Search size={18} strokeWidth={1.5} />
                <span>搜索研究</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>
        <div className="group-data-[collapsible=icon]:hidden">
          {searchOpen && (
            <div id="research-task-search" className="research-sidebar-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                value={search}
                placeholder="按任务名称搜索"
                aria-label="搜索科研任务"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearch("")
                    setSearchOpen(false)
                    searchButton.current?.focus()
                  }
                }}
              />
              <button
                type="button"
                aria-label="关闭搜索"
                onClick={() => {
                  setSearch("")
                  setSearchOpen(false)
                  searchButton.current?.focus()
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <details className="research-sidebar-history" ref={history} open>
            <summary>
              {search.trim() ? "搜索结果" : "最近任务"}
              <ChevronDown size={13} />
            </summary>
            <div className="research-history-list" aria-live="polite">
              {visibleTasks.map((task) => {
                const run = task.runs[task.runs.length - 1]
                return (
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                    className="research-task-link"
                    aria-current={
                      pathname === `/tasks/${task.id}` ? "page" : undefined
                    }
                    key={task.id}
                    onClick={close}
                  >
                    <MessageSquare size={16} strokeWidth={1.5} />
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        科研工作区
                        {run ? ` · ${statusLabels[run.status]}` : ""}
                      </small>
                    </span>
                  </Link>
                )
              })}
              {!visibleTasks.length && (
                <p className="research-history-note">
                  {tasks.isPending
                    ? "正在加载科研任务…"
                    : tasks.error
                      ? "连接服务后查看科研任务"
                      : search.trim()
                        ? "没有匹配的科研任务"
                        : "你的科研任务将显示在这里。"}
                </p>
              )}
            </div>
          </details>
          <section
            className="research-sidebar-projects"
            aria-labelledby="sidebar-projects-title"
          >
            <div className="research-projects-heading">
              <h2 id="sidebar-projects-title">项目</h2>
              <button
                type="button"
                aria-label="新建项目"
                disabled={projects.isPending || !!projects.error}
                onClick={() => {
                  setProjectName("")
                  setProjectError("")
                  setCreatingProject(true)
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            {projects.projects.map((project) => (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                key={project.id}
                className="research-project-link"
                aria-current={
                  pathname === `/projects/${project.id}` ? "page" : undefined
                }
                onClick={close}
              >
                <FolderOpen size={17} strokeWidth={1.5} />
                <span>{project.name}</span>
              </Link>
            ))}
            {projects.error && (
              <p className="research-history-note" role="alert">
                无法读取当前浏览器中保存的项目。
              </p>
            )}
          </section>
        </div>
      </SidebarContent>
      <SidebarFooter className="research-sidebar-footer">
        <div className="research-sidebar-caption group-data-[collapsible=icon]:hidden">
          <CircleDot size={12} />
          让研究与发现相连
        </div>
        <User user={user} />
      </SidebarFooter>
      <Dialog open={creatingProject} onOpenChange={setCreatingProject}>
        <DialogContent className="project-dialog">
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            Group related research tasks. 项目 are saved in this browser for
            your account.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!projectName.trim()) return
              try {
                projects.save([
                  ...projects.projects,
                  {
                    id: crypto.randomUUID(),
                    name: projectName.trim(),
                    taskIds: [],
                  },
                ])
                setCreatingProject(false)
              } catch (error) {
                setProjectError(
                  error instanceof Error ? error.message : "无法创建项目。",
                )
              }
            }}
          >
            <label htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              maxLength={80}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="例如：空间学习研究"
              required
            />
            {projectError && (
              <p role="alert" className="agent-error">
                {projectError}
              </p>
            )}
            <button
              className="project-action"
              type="submit"
              disabled={!projectName.trim()}
            >
              新建项目
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
export default AppSidebar
