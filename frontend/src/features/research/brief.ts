import { z } from "zod"

export const researchGoals = [
  {
    id: "trajectory",
    title: "Explore trajectories & headings",
    description:
      "Review movement paths and behavioral details, one video at a time.",
    tag: "Video-level exploration",
    question:
      "Check water maze trajectories and headings, flag unusual segments, and prepare exploratory figures.",
  },
  {
    id: "learning",
    title: "Compare training days",
    description:
      "Verify animals and trials, then explore learning changes within the same batch.",
    tag: "Verify before comparing",
    question:
      "Verify animal identities and valid trials, then compare behavior across training days within the same batch. Prepare figures and notes.",
  },
  {
    id: "report",
    title: "Draft a research report",
    description:
      "Bring evidence, figures, and findings into an editable report.",
    tag: "Traceable outputs",
    question:
      "Organize existing experimental materials, verify data sources, and draft an editable report covering methods, figures, and limitations.",
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
  return `${brief.question.trim()}\n\nData scope: ${brief.scope.trim() || "Not yet specified. Please help identify available data and batches first."}\n\nAnalysis criteria: Analyze batches separately; verify animal mapping and valid trials first; without spatial calibration, do not report centimeter-based units; heading toward a landmark does not establish that the animal saw it.`
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
