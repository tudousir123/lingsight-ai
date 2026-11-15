import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { useState } from "react"
import { ExperimentsService, type TrialSummary } from "@/client"
import { PageHeader } from "@/components/Common/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const pageSize = 5
const trainingDays = ["0804", "0805", "0806", "0807", "0808", "0809"] as const

function phaseLabel(phase: string) {
  if (phase === "training_day") return "训练期"
  if (phase === "probe_platform_present") return "探测期（有台）"
  return phase
}

function TrialRow({ trial }: { trial: TrialSummary }) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-foreground tracking-tight">
          {trial.video_name}
        </div>
        <div className="sr-only">{trial.id}</div>
      </TableCell>
      <TableCell>
        {trial.group_name} · {trial.mouse_id}
      </TableCell>
      <TableCell>{phaseLabel(trial.phase)}</TableCell>
      <TableCell>
        {trial.training_day
          ? `第 ${trial.training_day} 训练日`
          : trial.date_dir}
        <span className="block text-xs text-muted-foreground">
          {trial.session_label} · 试次 {trial.trial_no}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={trial.media_available ? "secondary" : "outline"}>
            {trial.media_available ? "视频可用" : "视频未接入"}
          </Badge>
          <Badge variant={trial.result_available ? "secondary" : "outline"}>
            {trial.result_available ? "结果可用" : "无离线结果"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <span
          className="inline-flex rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground"
          title={`试次详情页已随旧分析闭环下线：${trial.video_name}`}
        >
          {trial.id}
        </span>
      </TableCell>
    </TableRow>
  )
}

export function TrialDirectoryPage({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const [experimentId, setExperimentId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState("")
  const [mouseId, setMouseId] = useState("")
  const [phase, setPhase] = useState("all")
  const [dateDir, setDateDir] = useState("")
  const [search, setSearch] = useState("")
  const [skip, setSkip] = useState(0)

  const experiments = useQuery({
    queryKey: ["experiments"],
    queryFn: async () => (await ExperimentsService.listExperiments()).data.data,
    retry: false,
  })
  const selectedId = experimentId ?? experiments.data?.[0]?.id
  const selected = experiments.data?.find((item) => item.id === selectedId)
  const trials = useQuery({
    queryKey: ["trials", selectedId, groupName, mouseId, phase, dateDir, skip],
    queryFn: async () =>
      (
        await ExperimentsService.listTrials({
          path: { experiment_id: selectedId! },
          query: {
            group_name: groupName.trim() || undefined,
            mouse_id: mouseId.trim() || undefined,
            phase: phase === "all" ? undefined : phase,
            date_dir: dateDir.trim() || undefined,
            skip,
            limit: pageSize,
          },
        })
      ).data,
    enabled: Boolean(selectedId),
    retry: false,
  })
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible =
    trials.data?.data.filter((trial) => {
      const label =
        `${trial.video_name} ${trial.group_name} ${trial.mouse_id} ${trial.date_dir}`.toLowerCase()
      return tokens.every((token) => label.includes(token))
    }) ?? []

  const resetFilters = () => setSkip(0)
  const clearFilters = () => {
    setGroupName("")
    setMouseId("")
    setPhase("all")
    setDateDir("")
    setSearch("")
    setSkip(0)
  }
  const hasFilters = Boolean(
    groupName || mouseId || phase !== "all" || dateDir || search,
  )

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="实验与视频管理"
          description="从实验到单次行为记录，查看视频、复核素材与离线分析结果。"
          actions={
            <Badge variant="outline" className="gap-2 px-3 py-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-brand" />
              水迷宫研究
            </Badge>
          }
        />
      )}

      {experiments.isPending ? (
        <Card>
          <CardContent
            role="status"
            className="py-6 text-sm text-muted-foreground"
          >
            正在加载实验列表…
          </CardContent>
        </Card>
      ) : experiments.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <span>实验列表加载失败</span>
            <Button
              variant="outline"
              onClick={() => void experiments.refetch()}
            >
              重试
            </Button>
          </CardContent>
        </Card>
      ) : experiments.data.length === 0 ? (
        <Card>
          <CardContent className="space-y-1">
            <p>暂无可访问的实验。请联系管理员确认实验权限。</p>
            <p className="text-sm text-muted-foreground">
              新账号默认只能看到自己上传的视频及其项目内结果，不显示水迷宫整库；整库需管理员明确授权。
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="gap-3 py-4">
            <CardHeader>
              <CardTitle className="text-sm font-medium">当前实验</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedId}
                onValueChange={(value) => {
                  setExperimentId(value)
                  clearFilters()
                }}
              >
                <SelectTrigger
                  aria-label="选择实验"
                  className="w-full max-w-md"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {experiments.data.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {selected?.trial_count ?? 0} 条试次
              </span>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-medium">
                  试次视频
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {trials.data
                    ? `${trials.data.count} 条符合筛选条件`
                    : "读取试次目录"}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    aria-label="搜索试次"
                    placeholder="当前页搜索视频或动物"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <Input
                  aria-label="实验组"
                  placeholder="实验组"
                  value={groupName}
                  onChange={(event) => {
                    setGroupName(event.target.value)
                    resetFilters()
                  }}
                  className="w-28"
                />
                <Input
                  aria-label="鼠号"
                  placeholder="鼠号"
                  value={mouseId}
                  onChange={(event) => {
                    setMouseId(event.target.value)
                    resetFilters()
                  }}
                  className="w-24"
                />
                <Select
                  value={phase}
                  onValueChange={(value) => {
                    setPhase(value)
                    resetFilters()
                  }}
                >
                  <SelectTrigger aria-label="实验阶段" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部阶段</SelectItem>
                    <SelectItem value="training_day">训练期</SelectItem>
                    <SelectItem value="probe_platform_present">
                      探测期（有台）
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={dateDir || "all"}
                  onValueChange={(value) => {
                    setDateDir(value === "all" ? "" : value)
                    resetFilters()
                  }}
                >
                  <SelectTrigger aria-label="训练日" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部日期</SelectItem>
                    {trainingDays.map((day, index) => (
                      <SelectItem key={day} value={day}>
                        {day === "0809"
                          ? "0809 · 探测日"
                          : `第 ${index + 1} 训练日`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <p>
                  实验组、鼠号、阶段和日期筛选整个实验；关键词仅搜索当前页。
                </p>
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    清除筛选
                  </Button>
                )}
              </div>
              {trials.isPending ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  正在加载试次…
                </p>
              ) : trials.isError ? (
                <div className="flex items-center justify-between gap-3 py-6">
                  <span>试次列表加载失败</span>
                  <Button
                    variant="outline"
                    onClick={() => void trials.refetch()}
                  >
                    重试
                  </Button>
                </div>
              ) : trials.data.count === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  该实验没有符合条件的试次。
                </p>
              ) : visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  当前页没有匹配的试次，请调整搜索词。
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <Table className="min-w-[780px]">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead>视频</TableHead>
                        <TableHead>动物（实验组 · 鼠号）</TableHead>
                        <TableHead>阶段</TableHead>
                        <TableHead>日期 / 区块 / 试次</TableHead>
                        <TableHead>素材</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((trial) => (
                        <TrialRow key={trial.id} trial={trial} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {trials.data && trials.data.count > pageSize && (
                <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
                  <span>
                    共 {trials.data.count} 条 · 第{" "}
                    {Math.floor(skip / pageSize) + 1} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={skip === 0}
                    onClick={() => setSkip(Math.max(0, skip - pageSize))}
                  >
                    <ChevronLeft />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={skip + pageSize >= trials.data.count}
                    onClick={() => setSkip(skip + pageSize)}
                  >
                    下一页
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
