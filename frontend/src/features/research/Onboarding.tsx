import { Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChartNoAxesCombined,
  FileText,
  ScanLine,
  Table2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  briefPrompt,
  downloadText,
  type GoalId,
  readBrief,
  researchGoals,
  writeBrief,
} from "./brief"
import { markOnboardingSeen } from "./entry"
import { GuideScene } from "./GuideScene"
import { ResearchIllustration } from "./ResearchIllustration"
import "./research.css"

const stages = ["认识你的助手", "探索行为", "研究成果", "开始你的研究"]

const goalIcons = {
  trajectory: ScanLine,
  learning: ChartNoAxesCombined,
  report: FileText,
}

export default function Onboarding() {
  const navigate = useNavigate()
  const scroller = useRef<HTMLElement>(null)
  const wheelLockUntil = useRef(0)
  const wheelDistance = useRef(0)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top
        let current = 0
        root
          .querySelectorAll<HTMLElement>(".research-guide-scene")
          .forEach((section, index) => {
            if (
              section.getBoundingClientRect().top - top <
              root.clientHeight / 2
            )
              current = index
          })
        setStep(current)
      })
    }
    root.addEventListener("scroll", update, { passive: true })
    return () => {
      root.removeEventListener("scroll", update)
      cancelAnimationFrame(frame)
    }
  }, [])

  const goToStep = useCallback((index: number) => {
    const root = scroller.current
    const section = root?.querySelectorAll<HTMLElement>(
      ".research-guide-scene",
    )[index]
    if (!root || !section) return
    root.scrollTo({
      top:
        root.scrollTop +
        section.getBoundingClientRect().top -
        root.getBoundingClientRect().top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    })
  }, [])

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return
      if (event.target instanceof Element && event.target.closest("textarea"))
        return
      if (performance.now() < wheelLockUntil.current) {
        event.preventDefault()
        return
      }

      const scene = root.querySelectorAll<HTMLElement>(".research-guide-scene")[
        step
      ]
      if (!scene) return
      const bounds = scene.getBoundingClientRect()
      const viewport = root.getBoundingClientRect()
      // Let an oversized scene scroll normally until its content is visible.
      if (event.deltaY > 0 && bounds.bottom > viewport.bottom + 2) return
      if (event.deltaY < 0 && bounds.top < viewport.top - 2) return

      event.preventDefault()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? root.clientHeight
            : 1
      const distance = event.deltaY * unit
      if (Math.sign(wheelDistance.current) !== Math.sign(distance))
        wheelDistance.current = 0
      wheelDistance.current += distance
      if (Math.abs(wheelDistance.current) < 40) return
      const target = Math.max(
        0,
        Math.min(stages.length - 1, step + Math.sign(wheelDistance.current)),
      )
      wheelDistance.current = 0
      if (target === step) return
      wheelLockUntil.current = performance.now() + 850
      goToStep(target)
    }
    root.addEventListener("wheel", onWheel, { passive: false })
    return () => root.removeEventListener("wheel", onWheel)
  }, [goToStep, step])
  const [initial] = useState(readBrief)
  const [goal, setGoal] = useState<GoalId>(initial?.goal ?? "trajectory")
  const [scope, setScope] = useState(initial?.scope ?? "")
  const [question, setQuestion] = useState(initial?.question ?? "")
  const [storageError, setStorageError] = useState(false)
  const brief = { version: 1 as const, goal, scope, question }

  function enterWorkspace() {
    if (!question.trim()) return
    if (!writeBrief(brief)) {
      setStorageError(true)
      return
    }
    try {
      sessionStorage.removeItem("lingsight.consumed-brief")
    } catch {
      setStorageError(true)
      return
    }
    markOnboardingSeen()
    void navigate({ to: "/" })
  }

  return (
    <div className="research-onboarding" lang="zh">
      <header className="research-onboarding-header">
        <Link to="/welcome" className="research-wordmark">
          LingSight <span>Science</span>
        </Link>
        <Link to="/" onClick={markOnboardingSeen} className="research-skip">
          直接进入工作台 <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>
      <main
        ref={scroller}
        className="research-guide-main"
        aria-label="科研助手介绍"
      >
        <section
          className="research-guide-scene"
          inert={step !== 0}
          aria-label={stages[0]}
        >
          <GuideScene
            active={step === 0}
            first
            title={"你好，\n我是你的科研助手。"}
          >
            <p className="research-scene-subtitle">
              准备好探索动物行为背后的模式了吗？
            </p>
            <div className="research-welcome-mark" aria-hidden="true">
              <ScanLine size={38} strokeWidth={1} />
            </div>
            <p className="research-scene-caption">
              已接入水迷宫数据，可直接开始
            </p>
          </GuideScene>
        </section>
        <section
          className="research-guide-scene"
          inert={step !== 1}
          aria-label={stages[1]}
        >
          <GuideScene active={step === 1} title="看见行为的改变。">
            <p className="research-scene-subtitle">
              回顾轨迹与朝向，比较同批次内的训练日变化。
            </p>
            <div className="research-behavior-preview">
              <ResearchIllustration />
              <div className="research-behavior-labels">
                <span>
                  <ScanLine size={17} /> 轨迹与朝向
                </span>
                <span>
                  <ChartNoAxesCombined size={17} /> 训练日间的变化
                </span>
                <small>行为分析示意图</small>
              </div>
            </div>
          </GuideScene>
        </section>
        <section
          className="research-guide-scene"
          inert={step !== 2}
          aria-label={stages[2]}
        >
          <GuideScene
            active={step === 2}
            title="你的研究，可以在此基础上继续。"
          >
            <p className="research-scene-subtitle">
              图表、数据表与可编辑的报告保存在同一个任务里。
            </p>
            <div className="research-deliverables">
              <div>
                <ChartNoAxesCombined size={34} strokeWidth={1} />
                <strong>分析图表</strong>
                <span>看见行为变化</span>
              </div>
              <div>
                <Table2 size={34} strokeWidth={1} />
                <strong>结果数据表</strong>
                <span>保留计算过程</span>
              </div>
              <div>
                <FileText size={34} strokeWidth={1} />
                <strong>可编辑报告</strong>
                <span>打磨你的结论</span>
              </div>
            </div>
            <p className="research-scene-caption">
              示意产出 · 结果取决于可用数据
            </p>
          </GuideScene>
        </section>
        <section
          className="research-guide-scene"
          inert={step !== 3}
          aria-label={stages[3]}
        >
          <GuideScene active={step === 3} title="你想探索什么？">
            <p className="research-scene-subtitle">
              选一个起点，或直接提出你的问题。
            </p>
            <fieldset className="research-starters" aria-label="示例问题">
              {researchGoals.map((item) => {
                const Icon = goalIcons[item.id]
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={
                      goal === item.id && question === item.question
                    }
                    onClick={() => {
                      setGoal(item.id)
                      setQuestion(item.question)
                      setStorageError(false)
                    }}
                  >
                    <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                    {item.title}
                  </button>
                )
              })}
            </fieldset>
            <div className="research-composer">
              <label className="sr-only" htmlFor="research-question">
                研究问题
              </label>
              <textarea
                id="research-question"
                value={question}
                maxLength={8000}
                rows={3}
                placeholder="例如：这批小鼠在训练日间的表现如何？"
                onChange={(event) => setQuestion(event.target.value)}
                aria-describedby="research-handoff-note"
              />
              <div className="research-composer-footer">
                <span id="research-handoff-note">
                  可在工作台继续修改；发送后才开始分析。
                </span>
                <Button
                  className="research-primary"
                  disabled={!question.trim()}
                  onClick={enterWorkspace}
                >
                  进入工作台 <ArrowRight size={15} aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="research-start-details">
              <details
                className="research-scope"
                open={scope.trim() ? true : undefined}
              >
                <summary>
                  补充数据范围 <span>可选</span>
                </summary>
                <label className="sr-only" htmlFor="research-scope">
                  数据范围
                </label>
                <textarea
                  id="research-scope"
                  className="research-textarea"
                  rows={2}
                  maxLength={400}
                  placeholder="批次、训练日或视频名称"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                />
              </details>
              <span className="research-data-note">使用已接入的水迷宫数据</span>
            </div>
            {storageError && (
              <div role="alert" className="research-error">
                浏览器未能保存你的问题。输入仍在这里，可下载后带入工作台。
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      "lingsight-research-brief.md",
                      briefPrompt(brief),
                    )
                  }
                >
                  下载研究简报
                </button>
              </div>
            )}
          </GuideScene>
        </section>
      </main>
      <footer className="research-guide-footer">
        <span className="research-progress" aria-live="polite">
          {String(step + 1).padStart(2, "0")} / 04 <span>{stages[step]}</span>
        </span>
        <span className="research-scroll-hint">
          {step === 3 ? (
            <ArrowUp size={14} aria-hidden="true" />
          ) : (
            <ArrowDown size={14} aria-hidden="true" />
          )}
          {step === 3 ? "上滑回顾" : "下滑继续"}
        </span>
        <div className="research-step-controls">
          <button
            type="button"
            aria-label="上一步"
            disabled={step === 0}
            onClick={() => goToStep(step - 1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="下一步"
            disabled={step === stages.length - 1}
            onClick={() => goToStep(step + 1)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  )
}
