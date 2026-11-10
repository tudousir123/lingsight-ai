import { Link } from "@tanstack/react-router"
import { ArrowRight, CircleHelp } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import demoWaterMaze from "./assets/demo-water-maze.png"
import { experiment, sampleTrial } from "./data"

// Card and page composition adapted from shadcn/ui dashboard-01 (MIT).
export function SummaryCards({
  items,
}: {
  items: { label: string; value: string; detail: string }[]
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} className="gap-2 rounded-lg py-5 shadow-xs">
          <CardHeader className="gap-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums text-foreground">
              {item.value}
            </CardTitle>
            <CardAction>
              <Badge variant="outline" className="text-primary">
                示例
              </Badge>
            </CardAction>
            <p className="text-xs text-muted-foreground">{item.detail}</p>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
export function PageHeading({
  section,
  title,
  subtitle,
  actions,
  showSampleBadge = true,
}: {
  section: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  showSampleBadge?: boolean
}) {
  return (
    <>
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <span>{section}</span>
        <span>/</span>
        <span>{experiment}</span>
        {showSampleBadge && (
          <Badge variant="secondary" className="ml-auto">
            示例数据
          </Badge>
        )}
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </>
  )
}
export function PreviewNotice() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/80">
      <CircleHelp className="size-4 shrink-0" />
      界面预览使用虚构示例数据；视频分析、导入和报告导出尚未接入。
    </div>
  )
}
export function PageLink({
  to,
  children,
  outline = false,
}: {
  to: "/" | "/prepare" | "/results" | "/reports"
  children: ReactNode
  outline?: boolean
}) {
  return (
    <Button
      variant={outline ? "outline" : "default"}
      asChild
      className={
        outline ? "" : "bg-primary text-primary-foreground hover:bg-primary/90"
      }
    >
      <Link to={to}>{children}</Link>
    </Button>
  )
}
export function DemoAction({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button variant="outline" onClick={onClick}>
      {children}
    </Button>
  )
}
export function TrialLabel({ completed = false }: { completed?: boolean }) {
  return completed ? (
    <span>MWM_D2_A01_T1.mp4 · 对照组 / A01 · 第 2 天 · 试次 1</span>
  ) : (
    <span>{sampleTrial} · 对照组 / A01 · 第 3 天 · 试次 1</span>
  )
}
export function PoolFrame({
  boundary = true,
  marks = true,
  platform = true,
  trajectory = false,
}: {
  boundary?: boolean
  marks?: boolean
  platform?: boolean
  trajectory?: boolean
}) {
  return (
    <div className="relative aspect-[1672/941] overflow-hidden rounded-md bg-slate-300">
      <img
        src={demoWaterMaze}
        className="h-full w-full object-cover"
        alt="合成的水迷宫俯视示例画面"
      />
      <svg
        viewBox="0 0 1672 941"
        className="pointer-events-none absolute inset-0 h-full w-full"
        role="img"
        aria-label="示例几何与轨迹叠加"
      >
        <defs>
          <linearGradient id="mwm-trajectory">
            <stop stopColor="#2563eb" />
            <stop offset=".55" stopColor="#16b8c5" />
            <stop offset="1" stopColor="#f9b51d" />
          </linearGradient>
        </defs>
        {boundary && (
          <circle
            cx="836"
            cy="461"
            r="397"
            fill="none"
            stroke="#20d7e3"
            strokeWidth="5"
          />
        )}
        {marks && (
          <g stroke="#ed39a5" strokeWidth="5" fill="none">
            <rect x="802" y="5" width="66" height="66" rx="5" />
            <rect x="1248" y="385" width="72" height="72" rx="5" />
            <rect x="793" y="853" width="75" height="75" rx="5" />
            <rect x="346" y="389" width="75" height="75" rx="5" />
          </g>
        )}
        {platform && (
          <g>
            <circle
              cx="1020"
              cy="274"
              r="35"
              fill="none"
              stroke="#facc15"
              strokeWidth="5"
              strokeDasharray="13 9"
            />
            <rect
              x="1059"
              y="247"
              width="150"
              height="38"
              rx="5"
              fill="#0f172aba"
            />
            <text x="1070" y="272" fontSize="24" fill="#ffe55b">
              基准平台
            </text>
          </g>
        )}
        {trajectory && (
          <path
            d="M569 656 C620 610 683 675 717 608 S783 617 794 546 S858 564 871 500 S947 484 934 413 S1000 372 1020 274"
            fill="none"
            stroke="url(#mwm-trajectory)"
            strokeWidth="8"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  )
}
export function FrameControls({
  frame,
  setFrame,
}: {
  frame: number
  setFrame: (n: number) => void
}) {
  const seconds = frame / 30
  return (
    <div className="flex items-center gap-3 rounded-b-md bg-slate-900 px-4 py-2 text-xs text-white">
      <span className="tabular-nums">
        00:{seconds.toFixed(2).padStart(5, "0")} / 01:00
      </span>
      <input
        aria-label="视频帧位置"
        type="range"
        min="0"
        max="1800"
        value={frame}
        onChange={(e) => setFrame(Number(e.target.value))}
        className="min-w-0 flex-1 accent-brand"
      />
      <span>1×</span>
    </div>
  )
}
export function ChartKey() {
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-chart-1">● 对照组</span>
      <span className="text-chart-3">● 实验组</span>
    </div>
  )
}
export function InlineLink({
  to,
  children,
}: {
  to: "/" | "/prepare" | "/results" | "/reports"
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="size-4" />
    </Link>
  )
}
