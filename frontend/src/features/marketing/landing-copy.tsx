import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
} from "react"

export type LandingLang = "en" | "zh"

const STORE_KEY = "landing-lang"

const en = {
  header: {
    home: "LingSight Science home",
    nav: "Main navigation",
    signIn: "Sign in",
    getStarted: "Get started",
    switchTo: "中文",
    switchAria: "切换到中文 / Switch to Chinese",
  },
  hero: {
    eyebrowLead: "MEET",
    eyebrowTail: "· FLAGSHIP VISION MODEL",
    title: "Decode animal behavior, frame by frame.",
    getStarted: "Get started",
    explore: "Explore the science",
  },
  marquee: {
    heading: "For researchers around the world",
    pause: "Pause",
    resume: "Resume",
    pauseAria: "Pause institution marquee",
    resumeAria: "Resume institution marquee",
  },
  features: {
    heading: "Built for animal behavior research.",
    exampleCaption: "Illustrative examples · synthetic data",
    cards: [
      {
        title: "Frame by frame",
        description:
          "Mask, trajectory, head–tail keypoints, and frozen heading geometry — every frame stays reviewable.",
        mock: "tracking" as const,
      },
      {
        title: "Traceable to the source",
        description:
          "Every figure and claim links back to the data, algorithm version, and material version it came from.",
        mock: "provenance" as const,
      },
      {
        title: "Runs unattended",
        description:
          "Ask a question and close the laptop. The agent works read-only and waits for your answers.",
        mock: "transcript" as const,
      },
    ],
    reportLine1: "Escape latency fell across training days in both cohorts…",
    reportLine2:
      "Day 1 median 41.3 s → Day 5 median 14.8 s (cohort A, n = 12 animals).",
    chat: {
      time: "23:47",
      question: "Compare the two cohorts across five training days.",
      status1: "✓ Sources verified · 601 videos",
      status2: "✓ Criteria: mask-based platform contact",
      clarify: "3 videos lack platform calibration — proceed video-level?",
      reply: "Video-level only, noted in the report.",
    },
  },
  ethos: {
    label: "FLAGSHIP VISION MODEL",
    tagline: "Make every frame count.",
    trainedPrefix: "Trained on",
    trainedSuffix: "human-annotated images.",
    builtFor: "Built for animal behavior research.",
  },
  showcase: {
    heading: "From movement to meaning.",
    figures: [
      {
        title: "Spatial occupancy",
        alt: "Spatial occupancy heatmaps across training days and the probe trial",
      },
      {
        title: "Search strategies",
        alt: "Search strategy distributions across training and probe trials",
      },
      {
        title: "Learning curves",
        alt: "Escape latency and swimming speed across training days for three age groups",
      },
      {
        title: "Probe performance",
        alt: "Quadrant occupancy and swimming speed in probe trials for three age groups",
      },
    ],
  },
  workflow: {
    heading: "From one question to a traceable report.",
    steps: [
      {
        time: "09:12",
        title: "Describe the study.",
        note: "One sentence is enough.",
        bubbles: [
          {
            side: "user" as const,
            words:
              "Compare learning across the two cohorts over five training days.",
            delay: 0,
          },
        ],
      },
      {
        time: "09:13",
        title: "The agent works.",
        note: "Read-only on your experiment data. Asks when the criteria are unclear.",
        bubbles: [
          {
            side: "agent" as const,
            words: "Sources verified — 601 videos linked to the cohorts.",
            delay: 0,
          },
          {
            side: "agent" as const,
            words:
              "Hidden platform calibration is missing for 3 videos. Proceed video-level only?",
            delay: 0.9,
          },
          {
            side: "reply" as const,
            words: "Video-level only — state it in the report.",
            delay: 1.9,
          },
        ],
      },
      {
        time: "23:47",
        title: "Collect the deliverables.",
        note: "Figures, tables, and a report you can stand behind.",
        bubbles: [
          {
            side: "chips" as const,
            words: "escape-latency.svg · cohort-summary.csv · report.md",
            delay: 0,
          },
        ],
      },
    ],
  },
  materials: {
    heading: "Videos. Figures. Data.",
    aria: "Research material formats",
    formats: ["MP4", "PNG / SVG", "CSV", "JSON"],
  },
  closing: {
    overline: "LING SIGHT SCIENCE",
    heading: "Discover the patterns behind behavior.",
    cta: "Get started",
  },
  footer: {
    tagline: "Frame by frame · Precise recognition · Live analysis",
    features: "Features",
    workflow: "Workflow",
    outputs: "Outputs",
    openWorkspace: "Open workspace",
  },
}

export type LandingCopy = typeof en

const zh: LandingCopy = {
  header: {
    home: "LingSight Science 首页",
    nav: "主导航",
    signIn: "登录",
    getStarted: "开始使用",
    switchTo: "EN",
    switchAria: "Switch to English / 切换到英文",
  },
  hero: {
    eyebrowLead: "认识",
    eyebrowTail: "· 旗舰视觉模型",
    title: "逐帧解码动物行为。",
    getStarted: "开始使用",
    explore: "探索科学",
  },
  marquee: {
    heading: "服务全球研究者",
    pause: "暂停",
    resume: "继续",
    pauseAria: "暂停机构滚动",
    resumeAria: "继续机构滚动",
  },
  features: {
    heading: "为动物行为研究而生。",
    exampleCaption: "功能演示 · 合成示例数据",
    cards: [
      {
        title: "逐帧解析",
        description: "Mask、轨迹、头尾关键点与冻结朝向几何——每一帧都可回看。",
        mock: "tracking" as const,
      },
      {
        title: "溯源到数据",
        description: "每张图、每个结论都能回溯到它的数据、算法版本与素材版本。",
        mock: "provenance" as const,
      },
      {
        title: "无人值守",
        description: "提出问题，合上电脑。Agent 只读工作，会等你的答复。",
        mock: "transcript" as const,
      },
    ],
    reportLine1: "两个品系的逃逸潜伏期在训练日间持续下降…",
    reportLine2:
      "第 1 日中位数 41.3 s → 第 5 日 14.8 s（A 组，n = 12 只动物）。",
    chat: {
      time: "23:47",
      question: "比较两个品系在五个训练日里的学习差异。",
      status1: "✓ 数据源已核验 · 601 段视频",
      status2: "✓ 口径：mask 轮廓碰台判定",
      clarify: "有 3 段视频缺少平台标定——按视频级继续吗？",
      reply: "仅视频级，在报告中注明。",
    },
  },
  ethos: {
    label: "旗舰视觉模型",
    tagline: "让每一帧都有价值。",
    trainedPrefix: "基于",
    trainedSuffix: "张人工标注图像训练。",
    builtFor: "为动物行为研究而生。",
  },
  showcase: {
    heading: "从运动到意义。",
    figures: [
      { title: "空间占据", alt: "训练日与探测期的空间占据热图" },
      { title: "搜索策略", alt: "训练期与探测期的搜索策略分布" },
      { title: "学习曲线", alt: "三个年龄组在训练日的逃逸潜伏期与游泳速度" },
      { title: "探测期表现", alt: "三个年龄组探测期的象限占据与游泳速度" },
    ],
  },
  workflow: {
    heading: "从一个问题，到一份可溯源的报告。",
    steps: [
      {
        time: "09:12",
        title: "描述研究。",
        note: "一句话就够了。",
        bubbles: [
          {
            side: "user" as const,
            words: "比较两个品系在五个训练日里的学习差异。",
            delay: 0,
          },
        ],
      },
      {
        time: "09:13",
        title: "Agent 开始工作。",
        note: "只读访问你的实验数据；口径不清时会来问你。",
        bubbles: [
          {
            side: "agent" as const,
            words: "数据源已核验——601 段视频已关联到品系。",
            delay: 0,
          },
          {
            side: "agent" as const,
            words: "有 3 段视频缺少隐藏平台标定。仅按视频级继续？",
            delay: 0.9,
          },
          {
            side: "reply" as const,
            words: "仅视频级——在报告中注明。",
            delay: 1.9,
          },
        ],
      },
      {
        time: "23:47",
        title: "收取交付物。",
        note: "图表、数据，与你敢署名的研究报告。",
        bubbles: [
          {
            side: "chips" as const,
            words: "escape-latency.svg · cohort-summary.csv · report.md",
            delay: 0,
          },
        ],
      },
    ],
  },
  materials: {
    heading: "视频。图表。数据。",
    aria: "研究材料格式",
    formats: ["MP4", "PNG / SVG", "CSV", "JSON"],
  },
  closing: {
    overline: "LING SIGHT SCIENCE",
    heading: "发现行为背后的模式。",
    cta: "开始使用",
  },
  footer: {
    tagline: "逐帧解析 · 精准识别 · 实时分析",
    features: "功能",
    workflow: "流程",
    outputs: "产出",
    openWorkspace: "打开工作台",
  },
}

const dictionaries: Record<LandingLang, LandingCopy> = { en, zh }

type LandingLangContext = {
  lang: LandingLang
  setLang: Dispatch<SetStateAction<LandingLang>>
  c: LandingCopy
}

const LangContext = createContext<LandingLangContext | null>(null)

export function LandingLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<LandingLang>(() => {
    try {
      return localStorage.getItem(STORE_KEY) === "zh" ? "zh" : "en"
    } catch {
      return "en"
    }
  })
  const changeLang: Dispatch<SetStateAction<LandingLang>> = (value) => {
    const next = typeof value === "function" ? value(lang) : value
    setLang(next)
    try {
      localStorage.setItem(STORE_KEY, next)
    } catch {
      // Keep the language usable for this visit when storage is unavailable.
    }
  }
  return (
    <LangContext.Provider
      value={{ lang, setLang: changeLang, c: dictionaries[lang] }}
    >
      {children}
    </LangContext.Provider>
  )
}

export function useLandingCopy(): LandingLangContext {
  const context = useContext(LangContext)
  if (!context) {
    throw new Error("useLandingCopy must be used inside LandingLangProvider")
  }
  return context
}
