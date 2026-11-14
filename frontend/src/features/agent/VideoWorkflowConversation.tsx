import { Link } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Database,
  LoaderCircle,
  ScanLine,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { VideoAttachmentList } from "./VideoAttachment"
import {
  analyzeVideoWorkflow,
  defaultAnalysisQuestion,
  finishVideoTool,
  type InferenceRow,
  reviewVideoTool,
  saveVideoWorkflow,
  type VideoWorkflow,
  videoStages,
  videoWorkflowSampleUrl,
  videoWorkflowTask,
} from "./videoWorkflow"

const runningLabels: Record<number, string> = {
  0: "正在登记视频…",
  1: "正在生成预标注…",
  3: "正在执行正式推理…",
  5: "正在导入 MySQL…",
}

function InferenceRows({ rows }: { rows: InferenceRow[] }) {
  return (
    <div className="video-workflow-table">
      <table>
        <caption className="sr-only">模拟推理结果</caption>
        <thead>
          <tr>
            <th scope="col">视频</th>
            <th scope="col">帧数</th>
            <th scope="col">逃逸潜伏期（秒）</th>
            <th scope="col">轨迹覆盖率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.video}-${index}`}>
              <th scope="row">{row.video}</th>
              <td>{row.frames.toLocaleString("zh-CN")}</td>
              <td>{row.latency.toFixed(1)}</td>
              <td>{row.coverage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReviewCard({ flow }: { flow: VideoWorkflow }) {
  const [revising, setRevising] = useState(false)
  const [note, setNote] = useState("")
  const annotation = flow.stage === 2
  const version = annotation ? flow.annotationVersion : flow.inferenceVersion
  const lastFeedback = [...flow.feedback]
    .reverse()
    .find((item) => item.stage === flow.stage)

  return (
    <section
      className="video-workflow-card video-review-card"
      aria-labelledby="video-review-title"
    >
      <header>
        <h2 id="video-review-title">
          {annotation ? "请核对预标注" : "请核对推理结果"}
        </h2>
        <span>第 {version} 版 · 待确认</span>
      </header>
      <p>
        {annotation
          ? "核对动物身份、头尾点和实验区域，确认后开始正式推理。"
          : "核对轨迹、有效帧和指标，确认后将本批结果导入 MySQL。"}
      </p>
      {lastFeedback && (
        <p className="video-workflow-muted">
          上次核对意见：{lastFeedback.note}
        </p>
      )}
      {videoWorkflowSampleUrl && (
        <Dialog>
          <DialogTrigger className="video-review-preview">
            {annotation ? "查看预标注示例视频" : "查看推理叠加示例视频"}
          </DialogTrigger>
          <DialogContent className="video-source-dialog video-review-dialog">
            <DialogTitle>
              {annotation ? "预标注预览" : "推理叠加预览"}
            </DialogTitle>
            <DialogDescription>
              合成示例，展示水迷宫视频中的轨迹和关键点。
            </DialogDescription>
            <video
              controls
              preload="metadata"
              src={videoWorkflowSampleUrl}
              aria-label="合成标注示例视频"
            >
              <track kind="captions" />
            </video>
          </DialogContent>
        </Dialog>
      )}
      {!annotation && <InferenceRows rows={flow.rows} />}
      {revising ? (
        <form
          className="video-review-revision"
          onSubmit={(event) => {
            event.preventDefault()
            if (note.trim())
              saveVideoWorkflow(reviewVideoTool(flow, note.trim()))
          }}
        >
          <label htmlFor="video-review-note">核对意见</label>
          <textarea
            id="video-review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1200}
            placeholder="例如头尾点颠倒、轨迹中断或帧数不符"
          />
          <div className="video-review-actions">
            <button
              type="button"
              className="video-workflow-secondary"
              onClick={() => setRevising(false)}
            >
              取消
            </button>
            <button
              type="submit"
              className="video-workflow-primary"
              disabled={!note.trim()}
            >
              按意见重跑
            </button>
          </div>
        </form>
      ) : (
        <div className="video-review-actions">
          <button
            type="button"
            className="video-workflow-secondary"
            onClick={() => setRevising(true)}
          >
            退回修改
          </button>
          <button
            type="button"
            className="video-workflow-primary"
            onClick={() => saveVideoWorkflow(reviewVideoTool(flow))}
          >
            <Check size={16} />
            {annotation ? "通过，开始正式推理" : "通过，确认入库"}
          </button>
        </div>
      )}
    </section>
  )
}

export function VideoWorkflowConversation({
  flow,
  projectName,
}: {
  flow: VideoWorkflow
  projectName?: string
}) {
  const [draft, setDraft] = useState("")
  const bottom = useRef<HTMLDivElement>(null)
  const activeStep = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (flow.nextAt === null) return
    const timer = window.setTimeout(
      () => saveVideoWorkflow(finishVideoTool(flow)),
      Math.max(0, flow.nextAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [flow])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll when a tool or a new analysis adds content.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" })
    activeStep.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [flow.stage, flow.analyses.length])

  const canAnalyze = flow.stage >= 6
  const running = runningLabels[flow.stage]
  const submitAnalysis = (question: string) => {
    if (!question.trim() || !canAnalyze) return
    saveVideoWorkflow(analyzeVideoWorkflow(flow, question.trim()))
    setDraft("")
  }

  return (
    <div
      className="agent-workbench agent-project-chat video-workflow"
      lang="zh-CN"
    >
      <div className="agent-workspace">
        <div className="agent-scroll-area">
          <div className="agent-content video-workflow-content">
            {flow.projectId && (
              <div className="workspace-scope">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: flow.projectId }}
                >
                  <ArrowLeft size={14} /> {projectName ?? "返回项目"}
                </Link>
              </div>
            )}
            <header className="video-workflow-heading">
              <h1>{videoWorkflowTask(flow).title}</h1>
              <span>模拟工作流</span>
            </header>
            <div className="agent-user-message video-workflow-user">
              {flow.goal && <p>{flow.goal}</p>}
              <VideoAttachmentList videos={flow.videos} />
            </div>
            <div className="agent-response-heading">
              <ScanLine size={19} />
              <strong>LingSight 灵视科研</strong>
            </div>
            <div className="video-workflow-history">
              {flow.stage > 0 && (
                <p>
                  <Check size={14} /> 已登记 {flow.videos.length} 段视频
                </p>
              )}
              {flow.annotationVersion > 0 && (
                <p>
                  <Check size={14} /> 已生成预标注 · 第 {flow.annotationVersion}{" "}
                  版
                </p>
              )}
              {flow.stage > 2 && (
                <p>
                  <Check size={14} /> 人工核对通过
                </p>
              )}
              {flow.inferenceVersion > 0 && (
                <p>
                  <Check size={14} /> 正式推理完成 · 第 {flow.inferenceVersion}{" "}
                  版
                </p>
              )}
              {flow.stage > 4 && (
                <p>
                  <Check size={14} /> 推理结果已核对
                </p>
              )}
            </div>
            {running && (
              <p className="agent-wait" role="status">
                <LoaderCircle size={16} className="animate-spin" /> {running}
              </p>
            )}
            {(flow.stage === 2 || flow.stage === 4) && (
              <ReviewCard key={flow.stage} flow={flow} />
            )}
            {canAnalyze && (
              <section
                className="video-workflow-card video-mysql-card"
                aria-labelledby="video-mysql-title"
              >
                <header>
                  <h2 id="video-mysql-title">
                    <Database size={16} /> 已导入 MySQL
                  </h2>
                  <span>模拟入库</span>
                </header>
                <p>
                  {flow.mysqlRows.length} 段视频 ·{" "}
                  {flow.mysqlRows
                    .reduce((total, row) => total + row.frames, 0)
                    .toLocaleString("zh-CN")}{" "}
                  帧
                </p>
                {flow.stage === 6 && (
                  <button
                    type="button"
                    className="video-workflow-secondary"
                    onClick={() =>
                      submitAnalysis(flow.goal || defaultAnalysisQuestion)
                    }
                  >
                    分析已入库数据
                  </button>
                )}
              </section>
            )}
            {flow.analyses.map((analysis, index) => (
              <section
                className="video-analysis-turn"
                key={`${index}-${analysis.question}`}
              >
                <div className="agent-user-message">{analysis.question}</div>
                <div className="video-workflow-card">
                  <header>
                    <h2>数据库分析</h2>
                    <span>模拟数据</span>
                  </header>
                  <p>{analysis.answer}</p>
                  <InferenceRows rows={flow.mysqlRows} />
                </div>
              </section>
            ))}
            <div ref={bottom} />
          </div>
        </div>
        <div className="agent-composer-wrap video-workflow-composer">
          <ol className="video-workflow-progress" aria-label="视频分析进度">
            {videoStages.map((label, index) => (
              <li
                key={label}
                ref={index === flow.stage ? activeStep : undefined}
                aria-current={index === flow.stage ? "step" : undefined}
                data-done={index < flow.stage ? "" : undefined}
              >
                <span>
                  {index < flow.stage ? <Check size={13} /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault()
              submitAnalysis(draft)
            }}
          >
            <textarea
              aria-label="研究问题"
              disabled={!canAnalyze}
              value={draft}
              maxLength={12000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  submitAnalysis(draft)
                }
              }}
              placeholder={
                canAnalyze
                  ? "问数据库，例如：汇总每段视频的逃逸潜伏期…"
                  : flow.nextAt
                    ? "工具正在执行…"
                    : "请在对话中完成核对…"
              }
            />
            <div className="agent-composer-toolbar">
              <span className="agent-model-label">
                <Database size={14} />{" "}
                {canAnalyze ? "MySQL · 模拟数据" : "视频行为分析"}
              </span>
              <div className="agent-send-actions">
                <button
                  className="agent-send"
                  type="submit"
                  aria-label="发送研究问题"
                  disabled={!canAnalyze || !draft.trim()}
                >
                  <ArrowUp size={20} />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
