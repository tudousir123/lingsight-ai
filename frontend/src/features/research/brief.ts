import { z } from "zod"

export const researchGoals = [
  {
    id: "trajectory",
    title: "探索轨迹与朝向",
    description: "逐段回顾运动路径与行为细节，一次聚焦一段视频。",
    tag: "视频级探索",
    question: "检查水迷宫轨迹与朝向，标记异常片段，并准备探索性图表。",
  },
  {
    id: "learning",
    title: "比较训练日",
    description: "先核验动物与试次，再探索同批次内的学习变化。",
    tag: "先核验再比较",
    question:
      "核验动物映射与有效试次后，比较同批次内各训练日间的行为差异，并准备图表与说明。",
  },
  {
    id: "report",
    title: "起草研究报告",
    description: "把证据、图表与发现整理成可编辑的报告。",
    tag: "可溯源产出",
    question:
      "整理现有实验材料，核验数据来源，起草一份覆盖方法、图表与局限的可编辑报告。",
  },
] as const

const briefSchema = z.object({
  version: z.literal(1),
  goal: z.enum(["trajectory", "learning", "report"]),
  scope: z.string().max(400),
  question: z.string().trim().min(1).max(8000),
})

export type ResearchBrief = z.infer<typeof briefSchema>
export type GoalId = ResearchBrief["goal"]
export const BRIEF_KEY = "lingsight.research-brief.v1"

export function readBrief(): ResearchBrief | null {
  try {
    const result = briefSchema.safeParse(
      JSON.parse(sessionStorage.getItem(BRIEF_KEY) ?? "null"),
    )
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function writeBrief(brief: ResearchBrief): boolean {
  try {
    sessionStorage.setItem(BRIEF_KEY, JSON.stringify(briefSchema.parse(brief)))
    return true
  } catch {
    return false
  }
}

export function briefPrompt(brief: ResearchBrief) {
  return `${brief.question.trim()}\n\n数据范围：${brief.scope.trim() || "尚未指定。请先协助确认可用数据与批次。"}\n\n分析口径：不同批次分开分析；先核验动物映射与有效试次；缺少空间标定不报告厘米单位；朝向标志物不等于动物看到标志物。`
}

export function downloadText(
  name: string,
  text: string,
  type = "text/markdown",
) {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` }),
  )
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
