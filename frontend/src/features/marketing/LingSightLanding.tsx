import * as Tabs from '@radix-ui/react-tabs'
import { ArrowRight, ArrowUpRight, CircleDot, FileJson, FileVideo, Play, Download, Layers3, Database, ChartNoAxesCombined, Crosshair, Terminal, ScanLine, Radio } from 'lucide-react'
import { HeatmapPreview, MazeScene, ResearchLog, TrendChart } from './ResearchVisuals'
import { historicalSummary } from './historical'

import './landing.css'

const Link = 'a' as const

const metrics = [
  {number:'25',unit:'只',caption:'第一批实验鼠'},
  {number:'498',unit:'次',caption:'有效训练试次'},
  {number:'706,615',unit:'帧',caption:'有效视频帧'},
  {number:'95.90%',unit:'',caption:'头向计算覆盖率'},
]

function Reveal({children,className=''}:{children:React.ReactNode;className?:string}) {
  return <div className={className}>{children}</div>
}

function Header() {
  return <header className="marketing-header">
    <Link className="site-wordmark" href="/welcome" aria-label="LingSight Science 首页"><span>LingSight</span> <span className="wordmark-light">Science</span></Link>
    <nav className="header-actions" aria-label="网站导航">
      <Link className="pill pill-dark" href="#capabilities">功能</Link>
      <Link className="pill pill-dark mobile-hide" href="/">工作台</Link>
      <Link className="pill pill-white" href="/">快速开始 <ArrowUpRight size={14}/></Link>
    </nav>
  </header>
}

function InferenceReadout({mini=false}:{mini?:boolean}){
  return <div className={'inference-readout mono '+(mini?'mini':'')}>
    <div className="readout-line"><span>FRAME ENGINE</span><span className="code-orange">DESIGN PREVIEW</span></div>
    <div><em>input</em><span>2560 × 1440</span></div>
    <div><em>processing</em><span>FRAME BY FRAME</span></div>
    <div className="readout-separator"/>
    <div className="readout-line"><span>VISION PIPELINE</span><span className="code-green">3 CHANNELS</span></div>
    <div><em>mask</em><span>Instance silhouette</span></div>
    <div><em>heading</em><span>Head / Tail</span></div>
    <div><em>tracking</em><span>Trajectory & events</span></div>
    {!mini&&<><div className="readout-separator"/><div className="readout-line"><span>LIVE OUTPUT</span><span className="code-orange">API PENDING</span></div><div><em>stream</em><span>Waiting for model</span></div></>}
  </div>
}

function AppMock({hero=false}:{hero?:boolean}) {
  return <div className={'product-app-mock '+(hero?'hero-product-mock':'')}>
    <aside className="mock-sidebar">
      <div className="mock-sidebar-brand"><span className="mock-brand-mark">◌</span> LingSight <small>Science</small></div>
      <div className="mock-sidebar-link selected"><ScanLine size={15}/> 逐帧推理</div>
      <div className="mock-sidebar-link"><FileVideo size={15}/> 人工校准</div>
      <div className="mock-sidebar-link"><ChartNoAxesCombined size={15}/> 指标分析</div>
      <div className="mock-sidebar-bottom"><CircleDot size={12}/> Water Maze / 8 月</div>
    </aside>
    <div className="mock-main">
      <div className="mock-titlebar"><span>Research / Water Maze / Frame stream</span><span className="mock-status"><span className="status-dot"/> PRODUCT UI DEMO</span></div>
      <div className="mock-work-title">逐帧推理 <span className="muted">/ 精准视觉识别</span></div>
      <div className="mock-stage-grid">
        <div className="mock-video-wrapper"><div className="mock-stage-caption">INFERENCE FRAME / 01248 <span>2560 × 1440 · 30 FPS SOURCE</span></div><MazeScene inference/><div className="mock-video-timeline"><Play size={12}/><div className="mock-timeline-track"><i/></div><small>F01248 / F03600</small></div></div>
        <div className="mock-side-readout"><div className="mock-side-title">MODEL PIPELINE <span>UI PREVIEW</span></div><InferenceReadout/></div>
      </div>
    </div>
  </div>
}

function FeatureCards() {
  return <div className="feature-grid">
    <article className="feature-card">
      <div className="feature-card-label">01 / FRAME-BY-FRAME</div>
      <h3>逐帧推理，不遗漏行为细节。</h3>
      <p>逐帧解码、定位与追踪，对应每一帧的识别结果。</p>
      <div className="feature-inset feature-inset-video"><MazeScene compact inference/><div className="video-inset-toolbar"><span className="mono">F / 01248</span><div className="mini-timeline"><i/></div><span className="mono">FRAME ENGINE</span></div></div>
    </article>
    <article className="feature-card">
      <div className="feature-card-label">02 / PRECISE RECOGNITION</div>
      <h3>高精度识别，理解更多细节。</h3>
      <p>结合 Mask、头向、轨迹与事件，形成可审核的识别链。</p>
      <div className="feature-inset feature-inset-readout"><InferenceReadout mini/></div>
    </article>
    <article className="feature-card">
      <div className="feature-card-label">03 / REAL-TIME FEEDBACK</div>
      <h3>实时反馈，让结果随帧可见。</h3>
      <p>推理进度、目标状态与行为事件，同步呈现在时间轴。</p>
      <div className="feature-inset feature-inset-log"><div className="live-event-mock"><div className="live-mock-head"><Radio size={14}/> LIVE ANALYTICS <span>INTERFACE DEMO</span></div><div className="live-mock-grid"><div><span>FRAME STREAM</span><strong>01248</strong></div><div><span>MASK / TRACK</span><strong>3 CHANNELS</strong></div></div><div className="live-mock-line"><span>Decode</span><i/><span>Detect</span><i/><span>Analyze</span></div><div className="live-event-row"><span className="status-dot"/> 实时事件时间轴 <small>等待推理服务</small></div><div className="live-mock-footer">PROCESSING PIPELINE · DEMONSTRATION</div></div></div>
    </article>
  </div>
}

function Journey() {
  return <section id="workflow" className="journey-section section-shell">
    <div className="center-intro"><h2>从输入视频，到实时行为理解</h2><p>逐帧推理 · 高精度识别 · 实时反馈</p></div>
    <div className="research-timeline">
      <div className="timeline-row"><div className="timeline-narrative"><span className="mono muted">STEP 01</span><h3>逐帧读取。</h3><p>原始分辨率解码，精确对应帧号与时间戳。</p></div><span className="timeline-dot"/><div className="timeline-visual"><div className="task-prompt"><FileVideo size={15}/> 0806第三次-A2-2-2.mp4 <span className="mono muted">FRAME 01248 / 30 FPS</span></div></div></div>
      <div className="timeline-row"><div className="timeline-narrative"><span className="mono muted">STEP 02</span><h3>视觉识别。</h3><p>逐帧提取轮廓、头向和轨迹；人工可随时校准。</p></div><span className="timeline-dot"/><div className="timeline-visual"><div className="timeline-vision"><InferenceReadout/></div></div></div>
      <div className="timeline-row"><div className="timeline-narrative"><span className="mono muted">STEP 03</span><h3>实时分析。</h3><p>随推理进度显示行为事件与研究指标。</p></div><span className="timeline-dot"/><div className="timeline-visual"><div className="delivery-file"><Radio size={19}/><div><strong>Frame-level result stream</strong><small>mask · heading · trajectory · events</small></div><span className="file-check">UI PREVIEW</span></div></div></div>
    </div>
  </section>
}

function FeatureStory() {
  return <section id="capabilities" className="feature-story section-shell">
    <Reveal className="story-panel">
      <div className="story-text"><h2>逐帧推理，把微小变化放大。</h2><p>从单帧位置到连续轨迹，让每一次转向和探索都有对应的视频依据。</p></div>
      <div className="story-art"><div className="story-scene"><div className="window-chrome"><i/><i/><i/><span>water_maze / frame_01248</span></div><MazeScene inference/><div className="scene-note"><span className="mono">MASK · HEADING · TRAJECTORY</span><span className="mini-status">VISUAL DEMO</span></div></div></div>
    </Reveal>
    <Reveal className="story-panel reversed">
      <div className="story-art story-inset-brown"><div className="story-codebox"><div className="window-chrome"><i/><i/><i/><span>scene_calibration.json</span></div><div className="code-preview mono"><div><span className="line-number">01</span> <span className="code-orange">{'{'} </span></div><div><span className="line-number">02</span> &nbsp; <span className="code-muted">"coordinate_space"</span>: <span className="code-orange">{'{'}</span></div><div><span className="line-number">03</span> &nbsp;&nbsp;&nbsp; <span className="code-muted">"width"</span>: 2560,</div><div><span className="line-number">04</span> &nbsp;&nbsp;&nbsp; <span className="code-muted">"height"</span>: 1440</div><div><span className="line-number">05</span> &nbsp; {'}'},</div><div><span className="line-number">06</span> &nbsp; <span className="code-muted">"marks"</span>: <span className="code-orange">{'{'} </span></div><div><span className="line-number">07</span> &nbsp;&nbsp;&nbsp; <span className="code-muted">"pentacle"</span>: [282, 64],</div><div><span className="line-number">08</span> &nbsp;&nbsp;&nbsp; <span className="code-muted">"rectangle"</span>: [2275, 710]</div><div><span className="line-number">09</span> &nbsp; {'}'}</div><div><span className="line-number">10</span> {'}'}</div></div></div></div>
      <div className="story-text"><h2>高精度识别，也接受人工复核。</h2><p>模型输出与原始像素坐标对齐；遇到复杂画面，人工校准让研究过程更可靠。</p></div>
    </Reveal>
    <Reveal className="story-panel">
      <div className="story-text"><h2>实时反馈，连接行为与指标。</h2><p>从帧级识别走向趋势分析，让研究者及时发现值得复核的行为变化。</p></div>
      <div className="story-art story-inset-slate"><div className="story-chartbox"><div className="chartbox-top"><span>Target Mark enrichment · S</span><span className="mono muted">AUG 04–08</span></div><TrendChart/><div className="chartbox-bottom"><span>Mouse-weighted Δ</span><strong>+3.76 pp</strong><span className="muted">95% CI [+2.98, +4.54]</span></div></div></div>
    </Reveal>
    <Reveal className="story-panel reversed">
      <div className="story-art story-inset-green"><div className="story-delivery"><div className="story-delivery-top"><Terminal size={15}/> EVIDENCE EXPORT <span className="code-green mono">READY</span></div><div className="export-row"><FileJson size={19}/><span>scene_calibration.json</span><small>原始帧坐标</small></div><div className="export-row"><ChartNoAxesCombined size={19}/><span>historical_s.csv</span><small>已冻结指标</small></div><div className="export-row"><Database size={19}/><span>research_notes</span><small>待连接后端</small></div><div className="deliver-footer">本地内容由你掌握。连接 FastAPI 后可同步标注。</div></div></div>
      <div className="story-text"><h2>推理结果，最终落在科研证据上。</h2><p>视频、识别轨迹、标注和统计数据关联保存，便于回看、复算与导出。</p></div>
    </Reveal>
  </section>
}

function Artifacts() {
  return <section id="deliverables" className="section-shell artifacts-section">
    <div className="artifact-intro"><div><span className="mono muted tiny-overline">RESEARCH OUTPUTS</span><h2 className="section-title">分析结束，交付真正有用的结果。</h2></div><p>轨迹、热力图、指标曲线，让行为变化一眼可见。</p></div>
    <div className="artifacts-grid">
      <div className="artifact-card"><div className="artifact-heading"><div><h3>运动轨迹图</h3><p>路径、空间探索与目标区域。</p></div><span>01 / TRACK</span></div><div className="artifact-visual artifact-track"><div className="artifact-visual-label mono">TRACK PLOT · DEMO</div><MazeScene compact/></div></div>
      <div className="artifact-card"><div className="artifact-heading"><div><h3>空间停留热力图</h3><p>直观看出小鼠偏好停留的位置。</p></div><span>02 / HEATMAP</span></div><div className="artifact-visual artifact-heat"><div className="artifact-visual-label mono">SPATIAL HEATMAP · DEMO</div><HeatmapPreview/></div></div>
      <div className="artifact-card"><div className="artifact-heading"><div><h3>统计指标图表</h3><p>潜伏期、距离、速度与实验趋势。</p></div><span>03 / ANALYTICS</span></div><div className="artifact-visual artifact-chart"><div className="paper-chart"><span>Target Mark enrichment · S (pp)</span><TrendChart height={180} minimal/><small>2026 · 第一批已冻结历史汇总</small></div></div></div>
    </div>
    <div className="export-format-strip"><div><strong>最终交付格式</strong><span>科研图表、分析数据与可复核产物</span></div><div className="export-format-tags"><span>PNG / SVG <small>图表</small></span><span>CSV / XLSX <small>数据表</small></span><span>MP4 <small>标注回放</small></span><span>PDF <small>研究报告</small></span><span>JSON <small>逐帧数据</small></span></div></div>
    <p className="artifact-clarifier">轨迹与热力图为界面示意，趋势图使用已冻结历史结果。交付格式为最终产品规划；当前已支持标定 JSON 与历史 CSV 导出。</p>
  </section>
}

function PracticalTabs() {
  return <section className="section-shell practical-section"><h2 className="section-title">在一个工作台，完成从推理到审核</h2>
    <Tabs.Root className="practical-tabs" defaultValue="mark">
      <Tabs.List className="practical-tablist" aria-label="分析应用场景"><Tabs.Trigger value="mark">人工校准</Tabs.Trigger><Tabs.Trigger value="inspect">指标分析</Tabs.Trigger><Tabs.Trigger value="export">结果导出</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="mark" className="practical-content"><div><Crosshair size={25}/><h3>先把每个坐标点标准确。</h3><p>真实视频、可拖拽控制点、有效帧设置与草稿保存，集中在同一屏。</p><Link className="text-link" href="/">进入标注工作台 <ArrowRight size={15}/></Link></div><MazeScene compact/></Tabs.Content>
      <Tabs.Content value="inspect" className="practical-content"><div><ChartNoAxesCombined size={25}/><h3>分析结果有明确的来源。</h3><p>{historicalSummary.positiveMice} / {historicalSummary.mice} 只小鼠表现为正向超额朝向；没有把组间差异写成显著。</p><Link className="text-link" href="/">查看结果 <ArrowRight size={15}/></Link></div><TrendChart/></Tabs.Content>
      <Tabs.Content value="export" className="practical-content"><div><Download size={25}/><h3>标注草稿和统计 CSV 可导出。</h3><p>本地视频保留在你的浏览器中，确认之后再选择是否连接后端。</p><Link className="text-link" href="/">打开导出入口 <ArrowRight size={15}/></Link></div><ResearchLog detailed/></Tabs.Content>
    </Tabs.Root>
  </section>
}

export default function LandingPage() {
  return <div className="landing">
    <Header/>
    <main>
      <section className="hero-section">
        <div className="hero-copy"><div className="hero-eyebrow mono"><span className="status-dot"/> FRAME-LEVEL AI FOR ANIMAL BEHAVIOR</div><h1>逐帧推理。高精度识别。<br/>实时洞察每一个行为细节。</h1><p className="hero-lead">LingSight · 面向动物行为科研的智能视频分析平台。</p><div className="hero-buttons"><Link href="/" className="pill pill-white">体验推理工作台 <ArrowUpRight size={14}/></Link><Link href="#workflow" className="pill pill-secondary">了解完整分析流程 <ArrowUpRight size={14}/></Link></div><div className="hero-availability">当前开放逐帧查看与人工校准 · 智能推理服务接入中</div></div>
        <div className="hero-perspective" aria-hidden="true"><AppMock hero/></div>
      </section>
      <section id="evidence" className="metrics-strip section-shell"><p className="metrics-strip-label">基于 2026 年 8 月第一批水迷宫已冻结分析</p><div className="metrics-row">{metrics.map(item=><div key={item.caption}><strong>{item.number}<small>{item.unit}</small></strong><span>{item.caption}</span></div>)}</div><p className="metric-footnote">这些数字是历史数据，不是网页中的实时视频计算结果。</p></section>
      <section className="section-shell intro-features"><h2 className="section-title">让视频的每一帧，都有研究价值</h2><FeatureCards/></section>
      <Journey/>
      <FeatureStory/>
      <Artifacts/>
      <PracticalTabs/>
      <section className="closing-section section-shell"><div><span className="mono muted tiny-overline">LING SIGHT SCIENCE</span><h2>从逐帧识别开始，发现行为背后的规律。</h2><Link className="pill pill-white" href="/">进入推理工作台 <ArrowUpRight size={14}/></Link></div><div className="closing-orbit" aria-hidden="true"><span/><span/><span/></div></section>
    </main>
    <footer className="marketing-footer"><div><strong>LingSight Science</strong><span>逐帧推理 · 高精度识别 · 实时分析</span></div><div><a href="#capabilities">功能</a><a href="#workflow">研究流程</a><a href="#deliverables">交付物</a></div><div><Link href="/">进入应用</Link><small>© 2026 LingSight</small></div></footer>
  </div>
}
