import { Link } from "@tanstack/react-router"
import {
  Check,
  Copy,
  Database,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/Common/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { StreamHttpError, streamResearchQuery } from "./sse"
import type { QaAnswer, QaRejection, QaResult, StageEvent } from "./types"

const EXAMPLE_QUESTIONS = [
  "库里一共有多少只动物？",
  "训练期内各组每鼠每日的平均游泳速度是多少？",
  "训练期内 A3 组 2 号鼠每天的平均游泳距离分别是多少？",
] as const

const STAGE_LABELS: Record<StageEvent["stage"], string> = {
  generation: "生成 SQL",
  validation: "校验 SQL",
  execution: "执行查询",
}

const REASON_LABELS: Record<string, string> = {
  parse_error: "SQL 解析失败",
  non_select: "仅允许只读 SELECT",
  db_not_allowed: "数据库不在白名单",
  whitelist_violation: "表或列不在白名单",
  ambiguous_column: "列名歧义",
  execution_error: "查询执行失败",
  timeout: "查询超时（服务端限时）",
  provider_error: "模型服务异常",
}

/** 这三类失败换问法或稍后重试可能成功：横幅旁给一键重发。 */
const RETRYABLE_REASONS = new Set([
  "execution_error",
  "timeout",
  "provider_error",
])

const MAX_HISTORY = 20

type Exchange = {
  question: string
  stages: StageEvent[]
  result: QaResult | null
  error: string | null
}

type CompletedExchange = Exchange & { result: QaResult }

function reasonLabel(reasonCode: string) {
  return REASON_LABELS[reasonCode] ?? `查询被拒绝（${reasonCode}）`
}

function formatTime(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("zh-CN", { hour12: false })
}

function StageTimeline({
  stages,
  running,
}: {
  stages: StageEvent[]
  running: boolean
}) {
  if (stages.length === 0) return null
  return (
    <ol className="flex flex-col gap-1.5 text-sm" aria-label="查询阶段进度">
      {stages.map((event, index) => {
        const isLast = index === stages.length - 1
        const done = !isLast || !running
        return (
          <li
            key={`${event.attempt}-${event.stage}-${index}`}
            className="flex items-center gap-2"
          >
            {done ? (
              <Check
                className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <Loader2
                className="size-4 shrink-0 animate-spin text-primary"
                aria-hidden
              />
            )}
            <span
              className={
                done ? "text-foreground/80" : "font-medium text-foreground"
              }
            >
              {STAGE_LABELS[event.stage]}
            </span>
            {event.attempt > 1 && (
              <Badge variant="outline" className="text-xs">
                第 {event.attempt} 次尝试
              </Badge>
            )}
            {!done && (
              <span className="text-xs text-muted-foreground">进行中…</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function CopySql({ sql }: { sql: string }) {
  const [, copy] = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2"
      aria-label="复制 SQL"
      onClick={async () => {
        const ok = await copy(sql)
        if (ok) {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "已复制" : "复制"}
    </Button>
  )
}

function AnswerView({ answer }: { answer: QaAnswer }) {
  const source = answer.data_source
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm whitespace-pre-line text-foreground">
        {answer.caliber_note}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Database className="size-3.5" aria-hidden />
        <span>
          数据来源：{source.database} · 表 {source.tables.join("、")} ·{" "}
          {answer.row_count} 行（上限 {source.row_limit}
          {source.truncated ? "，已截断" : ""}）·{" "}
          {formatTime(source.queried_at)}
        </span>
      </p>
      {answer.empty ? (
        <Alert>
          <AlertTitle>查询结果为空</AlertTitle>
          <AlertDescription className="whitespace-pre-line">
            {answer.suggestion ?? "查询已按原 SQL 执行，结果集为空。"}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                {answer.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {answer.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex}>
                      {cell === null ? "—" : String(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground select-none">
          查看 SQL 与技术细节（{answer.attempts} 次生成）
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs leading-relaxed">
            {answer.sql}
          </pre>
          <div>
            <CopySql sql={answer.sql} />
          </div>
          {answer.trace.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {answer.trace.map((item, index) => (
                <li key={index}>
                  第 {item.attempt} 次 · {STAGE_LABELS[item.stage]}：
                  {reasonLabel(item.reason_code)} — {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  )
}

function RejectionView({
  rejection,
  onRetry,
  retryDisabled,
}: {
  rejection: QaRejection
  onRetry: () => void
  retryDisabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Alert variant="destructive">
        <AlertTitle>{reasonLabel(rejection.reason_code)}</AlertTitle>
        <AlertDescription className="whitespace-pre-line">
          {rejection.message}
        </AlertDescription>
      </Alert>
      {RETRYABLE_REASONS.has(rejection.reason_code) && (
        <div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onRetry}
            disabled={retryDisabled}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            重试
          </Button>
        </div>
      )}
      {rejection.attempts > 1 && (
        <p className="text-xs text-muted-foreground">
          共尝试 {rejection.attempts}{" "}
          次生成，均被安全校验或执行拒绝；约束未放宽。
        </p>
      )}
    </div>
  )
}

function HistoryPanel({
  history,
  active,
  onSelect,
  disabled,
}: {
  history: CompletedExchange[]
  active: Exchange | null
  onSelect: (exchange: Exchange) => void
  disabled: boolean
}) {
  return (
    <Card className="py-4">
      <CardHeader>
        <CardTitle className="text-sm">本次会话提问</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground">
            还没有提问；历史仅保留在本页签，刷新后清空。
          </p>
        )}
        {history.map((exchange, index) => {
          const isActive = active === exchange
          return (
            <button
              key={`${exchange.question}-${index}`}
              type="button"
              onClick={() => onSelect(exchange)}
              disabled={disabled}
              className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-wait disabled:opacity-50 ${
                isActive
                  ? "border-brand/40 bg-brand/10 text-foreground"
                  : "text-foreground/80 hover:bg-muted/60"
              }`}
            >
              <span className="line-clamp-2">{exchange.question}</span>
              {/* 历史只收留有 result 的问答（失败重试不入栈），result 恒非空 */}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {exchange.result.status === "ok"
                  ? exchange.result.empty
                    ? "空结果"
                    : `${exchange.result.row_count} 行`
                  : reasonLabel(exchange.result.reason_code)}
              </span>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function QaPage() {
  const [input, setInput] = useState("")
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [current, setCurrent] = useState<Exchange | null>(null)
  const [history, setHistory] = useState<CompletedExchange[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  // 阶段事件的镜像：完成时用它组装最终 Exchange，避免在 setState 更新器
  // 里再触发 setHistory（StrictMode 双调用会重复插入历史条目）。
  const stagesRef = useRef<StageEvent[]>([])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
      }
    }
  }, [])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || running) return
    const controller = new AbortController()
    abortRef.current = controller
    stagesRef.current = []
    setCurrent({ question: trimmed, stages: [], result: null, error: null })
    setRunning(true)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    let result: QaResult | null = null
    let failure: string | null = null
    try {
      result = await streamResearchQuery(trimmed, {
        signal: controller.signal,
        onStage: (event) => {
          stagesRef.current = [...stagesRef.current, event]
          setCurrent((prev) =>
            prev && prev.question === trimmed
              ? { ...prev, stages: stagesRef.current }
              : prev,
          )
        },
      })
      if (result === null) {
        failure = "连接中断：未收到结果事件，请重试。"
      }
    } catch (error) {
      if (controller.signal.aborted) return
      failure =
        error instanceof StreamHttpError && error.status === 401
          ? "登录已过期，请重新登录后再提问。"
          : "请求失败，请稍后重试或换个问法。"
    } finally {
      setRunning(false)
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    const exchange: Exchange = {
      question: trimmed,
      stages: stagesRef.current,
      result,
      error: failure,
    }
    setCurrent(exchange)
    if (result !== null) {
      setHistory((items) =>
        [{ ...exchange, result }, ...items].slice(0, MAX_HISTORY),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="RESEARCH QUERY"
        title="科研问答"
        description="用自然语言探索水迷宫数据，结合统计口径、结果与来源复核每一次回答。"
      />

      <Card className="gap-4 py-5">
        <CardHeader>
          <CardTitle className="text-base font-medium">
            你想了解什么？
          </CardTitle>
          <p className="text-xs leading-5 text-muted-foreground">
            支持查询已有科研数据。结果会保留统计口径与可追溯来源。
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void ask(input)
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={2000}
              placeholder="例如：训练期内 c2 组逐日的平均游泳速度是多少？"
              aria-label="研究问题"
              disabled={running}
            />
            <Button
              type="submit"
              disabled={running || !input.trim()}
              className="shrink-0 gap-1.5"
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <MessageCircleQuestion className="size-4" aria-hidden />
              )}
              {running ? `提问中（${elapsed} 秒）` : "提问"}
            </Button>
          </form>
          {running && (
            <p className="text-xs text-muted-foreground">
              正在生成并校验 SQL，模型思考可能需要数十秒，请勿重复提交。
            </p>
          )}
          {current === null && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                试试这些示例问题：
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <Button
                    key={example}
                    variant="secondary"
                    size="sm"
                    className="h-auto whitespace-normal py-1.5 text-left text-xs font-normal"
                    onClick={() => {
                      setInput(example)
                      void ask(example)
                    }}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {current && (
        <Card className="gap-3 py-4">
          <CardHeader>
            <h2 className="text-base leading-relaxed font-semibold text-foreground">
              {current.question}
            </h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <StageTimeline stages={current.stages} running={running} />
            {current.error && (
              <div className="flex flex-col gap-2">
                <Alert variant="destructive">
                  <AlertTitle>连接失败</AlertTitle>
                  <AlertDescription>{current.error}</AlertDescription>
                </Alert>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void ask(current.question)}
                    disabled={running}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    重试
                  </Button>
                </div>
              </div>
            )}
            {current.result?.status === "ok" && (
              <AnswerView answer={current.result} />
            )}
            {current.result?.status === "rejected" && (
              <RejectionView
                rejection={current.result}
                onRetry={() => void ask(current.question)}
                retryDisabled={running}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <p className="text-xs text-muted-foreground">
          提示：统计结论先看口径声明（逐鼠-逐日 vs
          试次直均），避免把伪重复结果写入论文； 想追溯单试次可从{" "}
          <Link to="/" className="text-primary hover:underline">
            实验管理
          </Link>{" "}
          进入试次页。
        </p>
        <HistoryPanel
          history={history}
          active={current}
          onSelect={setCurrent}
          disabled={running}
        />
      </div>
    </div>
  )
}
