import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleDot,
  Crosshair,
  Database,
  FileText,
  FileVideo,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  ScanLine,
  Search,
} from "lucide-react"
import { flagshipVisionModel } from "@/features/research/vision-model"
import acquisitionHeatmaps from "./assets/literature/02-acquisition-heatmaps.webp"
import learningCurves from "./assets/literature/06-learning-curves-5xfad.webp"
import quadrantResults from "./assets/literature/07-probe-quadrant-results.webp"
import searchStrategies from "./assets/literature/08-strategy-distribution-5xfad.webp"
import { InstitutionMarquee } from "./InstitutionMarquee"
import { InView } from "./InView"
import { RealResearchPreview } from "./RealResearchPreview"

import "./landing.css"
import "./research-window.css"
import "./landing-motion.css"
import "./ethos.css"
import "./research-showcase.css"

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
  return (
    <header className="marketing-header">
      <Link
        className="site-wordmark"
        href="/welcome"
        aria-label="LingSight Science home"
      >
        <span>LingSight</span> <span className="wordmark-light">Science</span>
      </Link>
      <nav className="header-actions" aria-label="Main navigation">
        <Link className="pill pill-dark" href="/login">
          Sign in
        </Link>
        <Link className="pill pill-white" href="/onboarding">
          Get started
        </Link>
      </nav>
    </header>
  )
}

function FlagshipModel() {
  return (
    <section
      className="section-shell intro-features ethos-section"
      id="ethos"
      aria-labelledby="ethos-title"
    >
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
            <span className="ethos-label mono">FLAGSHIP VISION MODEL</span>
          </div>
          <p className="ethos-tagline">Make every frame count.</p>
        </div>
        <div className="ethos-training">
          <p>
            Trained on{" "}
            <strong>
              {flagshipVisionModel.trainingImageCount.toLocaleString("en-US")}
            </strong>
            <br />
            human-annotated images.
          </p>
          <span>Built for animal behavior research.</span>
        </div>
      </div>
      <RealResearchPreview />
    </section>
  )
}

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

const researchFigures = [
  {
    title: "Spatial occupancy",
    src: acquisitionHeatmaps,
    alt: "Research example: spatial occupancy heatmaps across training days and the probe trial",
    width: 1512,
    height: 687,
  },
  {
    title: "Search strategies",
    src: searchStrategies,
    alt: "Research example: search strategy distributions across training and probe trials",
    width: 1530,
    height: 1170,
  },
  {
    title: "Learning curves",
    src: learningCurves,
    alt: "Research example: escape latency and swimming speed across training days for three age groups",
    width: 1230,
    height: 1407,
  },
  {
    title: "Probe performance",
    src: quadrantResults,
    alt: "Research example: quadrant occupancy and swimming speed in probe trials for three age groups",
    width: 1530,
    height: 1119,
  },
]

function ResearchShowcase() {
  return (
    <section
      id="capabilities"
      className="section-shell research-showcase"
      aria-labelledby="research-showcase-title"
    >
      <h2 id="research-showcase-title">From movement to meaning.</h2>
      <div className="research-figures-grid">
        {researchFigures.map(({ title, ...figure }) => (
          <InView key={title} className="research-figure-card">
            <figure>
              <figcaption>
                <h3>{title}</h3>
              </figcaption>
              <LiteratureFigure {...figure} />
            </figure>
          </InView>
        ))}
      </div>
    </section>
  )
}

const workflowSteps = [
  {
    title: "Prepare",
    description: "Bring videos, annotations, and experiment records together.",
    Icon: FileVideo,
  },
  {
    title: "Analyze",
    description: "Explore movement, heading, and behavioral patterns.",
    Icon: ChartNoAxesCombined,
  },
  {
    title: "Review",
    description: "Keep figures, data, and notes connected to their sources.",
    Icon: Crosshair,
  },
]

function ResearchWorkflow() {
  return (
    <section
      id="workflow"
      className="section-shell research-workflow"
      aria-labelledby="research-workflow-title"
    >
      <h2 id="research-workflow-title">One connected research workflow.</h2>
      <div className="research-workflow-steps">
        {workflowSteps.map(({ title, description, Icon }) => (
          <InView className="research-workflow-step" key={title}>
            <Icon size={24} strokeWidth={1.25} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{description}</p>
          </InView>
        ))}
      </div>
      <div id="deliverables" className="research-materials">
        <h3>Videos. Figures. Data.</h3>
        <ul aria-label="Research material formats">
          <li>MP4</li>
          <li>PNG / SVG</li>
          <li>CSV</li>
          <li>JSON</li>
        </ul>
      </div>
    </section>
  )
}

export default function LandingPage() {
  return (
    <div className="landing" lang="en">
      <Header />
      <main>
        <section className="hero-section">
          <div className="hero-copy hero-rise">
            <Link className="hero-eyebrow" href="#ethos">
              MEET {flagshipVisionModel.name} · FLAGSHIP VISION MODEL{" "}
              <ArrowUpRight size={13} />
            </Link>
            <h1>Decode animal behavior, frame by frame.</h1>
            <div className="hero-buttons">
              <Link href="/onboarding" className="pill pill-white">
                Get started
              </Link>
              <Link href="#capabilities" className="pill pill-secondary">
                Explore the science <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <div className="hero-perspective" aria-hidden="true">
            <ResearchWorkspacePreview />
          </div>
        </section>
        <InstitutionMarquee />
        <FlagshipModel />
        <ResearchShowcase />
        <ResearchWorkflow />
        <section className="closing-section section-shell">
          <div>
            <span className="mono muted tiny-overline">LING SIGHT SCIENCE</span>
            <h2>Discover the patterns behind behavior.</h2>
            <Link className="pill pill-white" href="/onboarding">
              Get started <ArrowUpRight size={14} />
            </Link>
          </div>
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
          <span>Frame by frame · Precise recognition · Live analysis</span>
        </div>
        <div>
          <a href="#capabilities">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#deliverables">Outputs</a>
        </div>
        <div>
          <Link href="/">Open workspace</Link>
          <small>© 2026 LingSight</small>
        </div>
      </footer>
    </div>
  )
}
