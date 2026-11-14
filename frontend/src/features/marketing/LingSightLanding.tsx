import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleDot,
  Database,
  FileText,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  ScanLine,
  Search,
} from "lucide-react"
import type { CSSProperties } from "react"
import { flagshipVisionModel } from "@/features/research/vision-model"
import acquisitionHeatmaps from "./assets/literature/02-acquisition-heatmaps.webp"
import learningCurves from "./assets/literature/06-learning-curves-5xfad.webp"
import quadrantResults from "./assets/literature/07-probe-quadrant-results.webp"
import searchStrategies from "./assets/literature/08-strategy-distribution-5xfad.webp"
import { InstitutionMarquee } from "./InstitutionMarquee"
import { InView } from "./InView"
import {
  type LandingLang,
  LandingLangProvider,
  useLandingCopy,
} from "./landing-copy"
import { RealResearchPreview } from "./RealResearchPreview"

import "./landing.css"
import "./research-window.css"
import "./landing-motion.css"
import "./ethos.css"
import "./research-showcase.css"
import "./assistant.css"

const Link = "a" as const

// Figure provenance and crop details: public/assets/literature/water-maze/manifest.json.
function LiteratureFigure({
  src,
  alt,
  width,
  height,
}: {
  src: string
  alt: string
  width: number
  height: number
}) {
  return (
    <div className="literature-figure">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

function Header() {
  const { c, setLang, lang } = useLandingCopy()
  return (
    <header className="marketing-header">
      <Link
        className="site-wordmark"
        href="/welcome"
        aria-label={c.header.home}
      >
        <span>LingSight</span> <span className="wordmark-light">Science</span>
      </Link>
      <nav className="header-actions" aria-label={c.header.nav}>
        <button
          type="button"
          className="pill pill-dark lang-toggle"
          onClick={() => setLang(lang === "en" ? "zh" : "en")}
          aria-label={c.header.switchAria}
        >
          {c.header.switchTo}
        </button>
        <Link className="pill pill-dark" href="/login">
          {c.header.signIn}
        </Link>
        <Link className="pill pill-white" href="/onboarding">
          {c.header.getStarted}
        </Link>
      </nav>
    </header>
  )
}

function FlagshipModel() {
  const { c } = useLandingCopy()
  return (
    <section
      className="section-shell intro-features ethos-section"
      id="ethos"
      aria-labelledby="ethos-title"
    >
      <InView className="landing-reveal">
        <div className="ethos-intro">
          <div>
            <div className="ethos-identity">
              <ScanLine
                className="ethos-symbol"
                size={24}
                strokeWidth={1.25}
                aria-hidden="true"
              />
              <h2 id="ethos-title">{flagshipVisionModel.name}</h2>
              <span className="ethos-label mono">{c.ethos.label}</span>
            </div>
            <p className="ethos-tagline">{c.ethos.tagline}</p>
          </div>
          <div className="ethos-training">
            <p>
              {c.ethos.trainedPrefix}{" "}
              <strong>
                {flagshipVisionModel.trainingImageCount.toLocaleString("en-US")}
              </strong>{" "}
              {c.ethos.trainedSuffix}
            </p>
            <span>{c.ethos.builtFor}</span>
          </div>
        </div>
      </InView>
      <InView className="landing-reveal">
        <RealResearchPreview />
      </InView>
    </section>
  )
}

// The product window mock mirrors the real (English) workspace UI and is
// wrapped aria-hidden in the hero, so it stays untranslated.
function ResearchWorkspacePreview() {
  return (
    <div className="research-window">
      <aside className="research-window-sidebar hero-drop">
        <div className="window-lights">
          <i />
          <i />
          <i />
        </div>
        <div className="research-window-brand">
          <ScanLine size={20} />
          <span>LingSight Lab</span>
          <span className="window-plan">SCIENCE</span>
          <ChevronDown size={13} />
        </div>
        <div className="window-nav-item">
          <Plus size={18} />
          New research task
        </div>
        <div className="window-nav-item">
          <Database size={18} />
          Experiments & data
        </div>
        <div className="window-nav-item">
          <ScanLine size={18} />
          Videos & annotations
        </div>
        <div className="window-nav-item">
          <ChartNoAxesCombined size={18} />
          Analysis & reports
        </div>
        <div className="window-nav-item">
          <Search size={18} />
          Search research
        </div>
        <div className="window-nav-caption">
          Recent tasks <ChevronDown size={12} />
        </div>
        <div className="window-task selected">
          <MessageSquare size={15} />
          <div>
            Water maze training analysis
            <span>Research workspace · Preview</span>
          </div>
        </div>
        <div className="window-task">
          <MessageSquare size={15} />
          <div>
            Trial & annotation review<span>Experiment records</span>
          </div>
        </div>
        <div className="window-nav-caption">
          Projects <Plus size={13} />
        </div>
        <div className="window-nav-item">
          <FolderOpen size={17} />
          Learning & memory
        </div>
        <div className="window-nav-item">
          <FolderOpen size={17} />
          Behavior research notes
        </div>
        <div className="window-sidebar-footer">
          <CircleDot size={13} /> YOUR RESEARCH, CONNECTED
        </div>
      </aside>
      <div className="research-window-main">
        <div className="window-tabbar hero-drop">
          <PanelLeft size={17} />
          <span>
            <MessageSquare size={14} />
            Water maze training analysis
          </span>
          <span>
            <ChartNoAxesCombined size={14} />
            Analysis & outputs
          </span>
          <MoreHorizontal size={18} />
        </div>
        <div className="window-conversation">
          <div className="window-user-prompt hero-drop">
            Compare behavioral changes across groups during training, verify the
            analysis criteria, and prepare a traceable research report.
          </div>
          <div className="window-agent-heading">
            <ScanLine size={20} />
            <strong>LingSight Science</strong>
            <span>Workspace preview</span>
          </div>
          <p className="window-agent-intro">
            Start with experimental data. Keep every step and every result
            connected to its source.
          </p>
          <div className="window-step-summary">
            Research workflow <span>Data · Criteria · Analysis · Outputs</span>
          </div>
          <div className="window-step hero-drop">
            <Database size={16} />
            <span>Link experiment records, videos, and offline results</span>
            <small>Sources</small>
          </div>
          <div className="window-step hero-drop">
            <Search size={16} />
            <span>Verify animal IDs, training days, and valid trials</span>
            <small>Analysis criteria</small>
          </div>
          <div className="window-step hero-drop">
            <ChartNoAxesCombined size={16} />
            <span>Summarize by animal and day to explore group trends</span>
            <small>Analysis</small>
          </div>
          <div className="window-step hero-drop">
            <FileText size={16} />
            <span>Organize figures, data tables, and research notes</span>
            <small>Outputs</small>
          </div>
          <div className="window-output-preview hero-drop">
            <div className="window-document-icon">
              <FileText size={28} />
            </div>
            <div>
              <strong>Water maze training analysis</strong>
              <span>Research report · Output preview</span>
            </div>
            <span className="window-output-tag">Markdown</span>
          </div>
          <div className="window-output-files hero-drop">
            <span>
              <ChartNoAxesCombined size={14} />
              behavior_metrics.svg
            </span>
            <span>
              <Database size={14} />
              animal_daily_summary.csv
            </span>
          </div>
          <div className="window-result-preview hero-drop">
            <div>
              <span>SPATIAL PATTERNS</span>
              <strong>
                Follow the learning.
                <br />
                See the pattern.
              </strong>
              <small>Training heatmaps · Example</small>
            </div>
            <LiteratureFigure
              src={acquisitionHeatmaps}
              alt="Example spatial occupancy heatmaps across training days and the probe trial"
              width={1512}
              height={687}
            />
          </div>
          <div className="window-composer">
            <span>Explore this research question further…</span>
            <ArrowUpRight size={16} />
          </div>
        </div>
      </div>
      <aside className="research-window-overview hero-drop">
        <div>
          <PanelLeft size={15} />
          Overview
        </div>
        <span>Workflow preview</span>
        {[
          "Define experiment scope",
          "Verify data sources",
          "Review analysis criteria",
          "Analyze behavior metrics",
          "Summarize findings",
        ].map((step) => (
          <p key={step}>
            <Check size={13} />
            {step}
          </p>
        ))}
        <div className="window-overview-lines">
          <i />
          <i />
          <i />
        </div>
      </aside>
    </div>
  )
}

const figureAssets = [
  acquisitionHeatmaps,
  searchStrategies,
  learningCurves,
  quadrantResults,
]
const figureSizes: Array<[number, number]> = [
  [1512, 687],
  [1530, 1170],
  [1230, 1407],
  [1530, 1119],
]

function ResearchShowcase() {
  const { c } = useLandingCopy()
  return (
    <section
      id="capabilities"
      className="section-shell research-showcase"
      aria-labelledby="research-showcase-title"
    >
      <h2 id="research-showcase-title">{c.showcase.heading}</h2>
      <div className="research-figures-grid">
        {c.showcase.figures.map((figure, index) => (
          <InView key={figure.title} className="research-figure-card">
            <figure>
              <figcaption>
                <h3>{figure.title}</h3>
              </figcaption>
              <LiteratureFigure
                src={figureAssets[index]}
                alt={figure.alt}
                width={figureSizes[index][0]}
                height={figureSizes[index][1]}
              />
            </figure>
          </InView>
        ))}
      </div>
    </section>
  )
}

function ResearchWorkflow() {
  const { c } = useLandingCopy()
  return (
    <section
      id="workflow"
      className="section-shell research-workflow"
      aria-labelledby="research-workflow-title"
    >
      <h2 id="research-workflow-title">{c.workflow.heading}</h2>
      <AgentTimeline />
      <InView className="landing-reveal">
        <div id="deliverables" className="research-materials">
          <h3>{c.materials.heading}</h3>
          <ul aria-label={c.materials.aria}>
            {c.materials.formats.map((format) => (
              <li key={format}>{format}</li>
            ))}
          </ul>
        </div>
      </InView>
    </section>
  )
}

/** Staggered hero rise: words in English, single characters in Chinese. */
function HeroWords({ text, lang }: { text: string; lang: LandingLang }) {
  const units = lang === "zh" ? Array.from(text) : text.split(" ")
  const step = lang === "zh" ? 0.045 : 0.06
  return (
    <span aria-hidden="true">
      {units.map((unit, index) => (
        <span
          key={`${unit}-${String(index)}`}
          className="hero-word"
          style={{ "--d": `${0.35 + index * step}s` } as CSSProperties}
        >
          {unit}
        </span>
      ))}
    </span>
  )
}

function TrackingMock() {
  return (
    <svg
      className="feature-mock-canvas"
      viewBox="0 0 320 180"
      role="img"
      aria-label="Per-frame mouse trajectory inside the pool with heading vector"
    >
      <circle
        cx="160"
        cy="92"
        r="72"
        fill="none"
        stroke="#2c3138"
        strokeWidth="1.5"
      />
      <circle
        cx="196"
        cy="64"
        r="16"
        fill="none"
        stroke="#3b424b"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <polyline
        points="52,150 78,138 96,120 118,104 142,92 166,84 188,72 204,58 216,44"
        fill="none"
        stroke="#00d8ff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="translate(216 44) rotate(-40)">
        <line x1="0" y1="-9" x2="0" y2="9" stroke="#fa5f29" strokeWidth="2" />
        <polygon points="0,-13 4,-5 -4,-5" fill="#fa5f29" />
      </g>
      <circle cx="52" cy="150" r="4.5" fill="#ff3c6a" />
      <text x="18" y="24" className="mono" fill="#5f6a76" fontSize="9">
        frame 2412 / 2853 · heading −38.2°
      </text>
    </svg>
  )
}

function ProvenanceMock() {
  const { c } = useLandingCopy()
  return (
    <div className="feature-mock feature-mock--report" aria-hidden="true">
      <p className="report-line">{c.features.reportLine1}</p>
      <p className="report-line report-line--dim">{c.features.reportLine2}</p>
      <div className="report-chips">
        <span>water_maze_v3 · read-only</span>
        <span>heading v9 · frozen</span>
        <span>figures sha256 3f2a…</span>
      </div>
      <div className="report-figure" />
    </div>
  )
}

function TranscriptMock() {
  const { c } = useLandingCopy()
  const chat = c.features.chat
  return (
    <div className="feature-mock feature-mock--chat" aria-hidden="true">
      <p className="chat-time mono">{chat.time}</p>
      <p className="chat-bubble chat-bubble--user">{chat.question}</p>
      <div className="chat-status">
        <span>{chat.status1}</span>
        <span>{chat.status2}</span>
      </div>
      <p className="chat-bubble chat-bubble--agent">{chat.clarify}</p>
      <p className="chat-bubble chat-bubble--reply">{chat.reply}</p>
    </div>
  )
}

function AssistantFeatures() {
  const { c } = useLandingCopy()
  return (
    <section
      id="assistant"
      className="section-shell assistant-features"
      aria-labelledby="assistant-title"
    >
      <h2 id="assistant-title">{c.features.heading}</h2>
      <p className="example-caption">{c.features.exampleCaption}</p>
      <div className="assistant-cards">
        {c.features.cards.map((card, index) => (
          <InView
            key={card.title}
            className={`assistant-card delay-${index + 1}`}
          >
            <h3>{card.title}</h3>
            <p>{card.description}</p>
            {card.mock === "tracking" && <TrackingMock />}
            {card.mock === "provenance" && <ProvenanceMock />}
            {card.mock === "transcript" && <TranscriptMock />}
          </InView>
        ))}
      </div>
    </section>
  )
}

function AgentTimeline() {
  const { c } = useLandingCopy()
  return (
    <div className="agent-timeline">
      <p className="example-caption">{c.features.exampleCaption}</p>
      {c.workflow.steps.map((step) => (
        <InView key={step.time} className="agent-step">
          <span className="agent-rail" aria-hidden="true" />
          <span className="agent-dot" aria-hidden="true" />
          <p className="agent-time mono">{step.time}</p>
          <h3>{step.title}</h3>
          <p className="agent-note">{step.note}</p>
          {step.bubbles.map((bubble, index) =>
            bubble.side === "chips" ? (
              <p
                key={String(index)}
                className="agent-chips ilo-item"
                style={{ animationDelay: `${bubble.delay}s` }}
              >
                {bubble.words.split(" · ").map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </p>
            ) : (
              <p
                key={String(index)}
                className={`chat-bubble chat-bubble--${bubble.side} ilo-item`}
                style={{ animationDelay: `${bubble.delay}s` }}
              >
                {bubble.words.split(" ").map((word, wordIndex) => (
                  <span
                    key={`${word}-${String(wordIndex)}`}
                    className="ilo-word"
                    style={{
                      animationDelay: `${bubble.delay + wordIndex * 0.03}s`,
                    }}
                  >
                    {word}{" "}
                  </span>
                ))}
              </p>
            ),
          )}
        </InView>
      ))}
    </div>
  )
}

function Landing() {
  const { c, lang } = useLandingCopy()
  return (
    <div className="landing" lang={lang}>
      <Header />
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <Link className="hero-eyebrow hero-rise" href="#ethos">
              {c.hero.eyebrowLead} {flagshipVisionModel.name}{" "}
              {c.hero.eyebrowTail} <ArrowUpRight size={13} />
            </Link>
            <h1>
              <span className="sr-only">{c.hero.title}</span>
              <HeroWords text={c.hero.title} lang={lang} />
            </h1>
            <div
              className="hero-buttons hero-drop"
              style={{ "--hero-delay": "0.95s" } as CSSProperties}
            >
              <Link href="/onboarding" className="pill pill-white">
                {c.hero.getStarted}
              </Link>
              <Link href="#capabilities" className="pill pill-secondary">
                {c.hero.explore} <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <div className="hero-perspective" aria-hidden="true">
            <ResearchWorkspacePreview />
          </div>
        </section>
        <InView className="landing-reveal">
          <InstitutionMarquee />
        </InView>
        <AssistantFeatures />
        <FlagshipModel />
        <ResearchShowcase />
        <ResearchWorkflow />
        <section className="closing-section section-shell">
          <InView className="landing-reveal">
            <div>
              <span className="mono muted tiny-overline">
                {c.closing.overline}
              </span>
              <h2>{c.closing.heading}</h2>
              <Link className="pill pill-white" href="/onboarding">
                {c.closing.cta} <ArrowUpRight size={14} />
              </Link>
            </div>
          </InView>
          <div className="closing-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>
      <footer className="marketing-footer">
        <div>
          <strong>LingSight Science</strong>
          <span>{c.footer.tagline}</span>
        </div>
        <div>
          <a href="#capabilities">{c.footer.features}</a>
          <a href="#workflow">{c.footer.workflow}</a>
          <a href="#deliverables">{c.footer.outputs}</a>
        </div>
        <div>
          <Link href="/">{c.footer.openWorkspace}</Link>
          <small>© 2026 LingSight</small>
        </div>
      </footer>
    </div>
  )
}

export default function LandingPage() {
  return (
    <LandingLangProvider>
      <Landing />
    </LandingLangProvider>
  )
}
