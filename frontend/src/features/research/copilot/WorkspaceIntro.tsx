import { Link } from "@tanstack/react-router"
import { ArrowUpRight, ChartNoAxesCombined, Play } from "lucide-react"
import { ResearchIllustration } from "../ResearchIllustration"

const cloudPrompt =
  "创建「水迷宫训练日对比」项目，从网盘选择视频，推理后比较第 1 天和第 5 天的逃逸潜伏期及路径长度。"
const localPrompt =
  "创建「水迷宫视频分析」项目，选择本地视频，推理后逐视频汇总逃逸潜伏期和路径长度。"

export function WorkspaceIntro({
  onUsePrompt,
}: {
  onUsePrompt: (prompt: string) => void
}) {
  return (
    <div className="copilot-intro">
      <h1>动物行为研究</h1>
      <div className="copilot-launch-grid">
        <div className="copilot-launch-primary">
          <button
            className="copilot-launch-tile"
            type="button"
            onClick={() => onUsePrompt(cloudPrompt)}
          >
            <span className="copilot-launch-copy">
              <strong>水迷宫分析</strong>
              <span>从网盘选视频，比较训练日</span>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
          <div className="copilot-launch-maze" aria-hidden="true">
            <ResearchIllustration compact />
          </div>
        </div>
        <button
          className="copilot-launch-tile"
          type="button"
          onClick={() => onUsePrompt(localPrompt)}
        >
          <span className="copilot-launch-copy">
            <strong>本地视频</strong>
            <span>选择本次实验录像</span>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
          <span
            className="copilot-launch-art copilot-launch-video"
            aria-hidden="true"
          >
            <span className="copilot-film-sheet" />
            <span className="copilot-film-frame">
              <Play size={19} />
            </span>
          </span>
        </button>
        <Link className="copilot-launch-tile" to="/analysis">
          <span className="copilot-launch-copy">
            <strong>研究成果</strong>
            <span>查看图表与报告</span>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
          <span
            className="copilot-launch-art copilot-launch-report"
            aria-hidden="true"
          >
            <span className="copilot-report-sheet" />
            <span className="copilot-report-figure">
              <ChartNoAxesCombined size={33} />
            </span>
          </span>
        </Link>
      </div>
    </div>
  )
}
