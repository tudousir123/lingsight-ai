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

const stages = [
  "Meet your assistant",
  "Explore behavior",
  "Research outputs",
  "Start your research",
]

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
    <div className="research-onboarding" lang="en">
      <header className="research-onboarding-header">
        <Link to="/welcome" className="research-wordmark">
          LingSight <span>Science</span>
        </Link>
        <Link to="/" onClick={markOnboardingSeen} className="research-skip">
          Explore the workspace <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>
      <main
        ref={scroller}
        className="research-guide-main"
        aria-label="Research assistant introduction"
      >
        <section
          className="research-guide-scene"
          inert={step !== 0}
          aria-label={stages[0]}
        >
          <GuideScene
            active={step === 0}
            first
            title={"Hi,\nI’m your research assistant."}
          >
            <p className="research-scene-subtitle">
              Ready to explore the patterns behind animal behavior?
            </p>
            <div className="research-welcome-mark" aria-hidden="true">
              <ScanLine size={38} strokeWidth={1} />
            </div>
            <p className="research-scene-caption">
              Starting with the water maze data already connected
            </p>
          </GuideScene>
        </section>
        <section
          className="research-guide-scene"
          inert={step !== 1}
          aria-label={stages[1]}
        >
          <GuideScene active={step === 1} title="See how behavior changes.">
            <p className="research-scene-subtitle">
              Review trajectories and headings. Compare training days within the
              same batch.
            </p>
            <div className="research-behavior-preview">
              <ResearchIllustration />
              <div className="research-behavior-labels">
                <span>
                  <ScanLine size={17} /> Trajectories & headings
                </span>
                <span>
                  <ChartNoAxesCombined size={17} /> Changes across training days
                </span>
                <small>Illustrative behavior analysis</small>
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
            title="Your research, ready to build on."
          >
            <p className="research-scene-subtitle">
              Figures, data tables, and editable reports stay together in one
              task.
            </p>
            <div className="research-deliverables">
              <div>
                <ChartNoAxesCombined size={34} strokeWidth={1} />
                <strong>Analysis figures</strong>
                <span>See behavioral changes</span>
              </div>
              <div>
                <Table2 size={34} strokeWidth={1} />
                <strong>Result tables</strong>
                <span>Keep the calculation trail</span>
              </div>
              <div>
                <FileText size={34} strokeWidth={1} />
                <strong>Editable reports</strong>
                <span>Refine your findings</span>
              </div>
            </div>
            <p className="research-scene-caption">
              Illustrative outputs · Results depend on the available data
            </p>
          </GuideScene>
        </section>
        <section
          className="research-guide-scene"
          inert={step !== 3}
          aria-label={stages[3]}
        >
          <GuideScene
            active={step === 3}
            title="What would you like to explore?"
          >
            <p className="research-scene-subtitle">
              Choose a starting point, or ask your own question.
            </p>
            <fieldset
              className="research-starters"
              aria-label="Example questions"
            >
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
                Research question
              </label>
              <textarea
                id="research-question"
                value={question}
                maxLength={8000}
                rows={3}
                placeholder="For example: How does this batch of mice perform across training days?"
                onChange={(event) => setQuestion(event.target.value)}
                aria-describedby="research-handoff-note"
              />
              <div className="research-composer-footer">
                <span id="research-handoff-note">
                  Edit in the workspace. Analysis starts only when you send.
                </span>
                <Button
                  className="research-primary"
                  disabled={!question.trim()}
                  onClick={enterWorkspace}
                >
                  Enter workspace <ArrowRight size={15} aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="research-start-details">
              <details
                className="research-scope"
                open={scope.trim() ? true : undefined}
              >
                <summary>
                  Add data scope <span>Optional</span>
                </summary>
                <label className="sr-only" htmlFor="research-scope">
                  Data scope
                </label>
                <textarea
                  id="research-scope"
                  className="research-textarea"
                  rows={2}
                  maxLength={400}
                  placeholder="Batch, training days, or video names"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                />
              </details>
              <span className="research-data-note">
                Using the water maze data already connected
              </span>
            </div>
            {storageError && (
              <div role="alert" className="research-error">
                This browser could not save your question. Your input is still
                here. Download it to bring into the workspace.
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      "lingsight-research-brief.md",
                      briefPrompt(brief),
                    )
                  }
                >
                  Download research brief
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
          {step === 3 ? "Scroll up to revisit" : "Scroll down to continue"}
        </span>
        <div className="research-step-controls">
          <button
            type="button"
            aria-label="Previous step"
            disabled={step === 0}
            onClick={() => goToStep(step - 1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="Next step"
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
