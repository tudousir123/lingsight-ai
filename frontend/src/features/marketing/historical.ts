export interface DailyMetric {
  day: number
  date: string
  targetMarkS: number
}

// Frozen historical analysis, not live data from the current video.
export const historicalSummary = {
  batch: '8 月第一批',
  mice: 25,
  validTrials: 498,
  validFrames: 706_615,
  headingCoverage: 95.9,
  markDelta: 3.76,
  markDeltaCi: [2.98, 4.54] as const,
  positiveMice: 24,
  trendSlope: 1.38,
  trendP: 0.001,
} as const

export const historicalDaily: DailyMetric[] = [
  { day: 1, date: '2026-08-04', targetMarkS: 2.44 },
  { day: 2, date: '2026-08-05', targetMarkS: -0.13 },
  { day: 3, date: '2026-08-06', targetMarkS: 1.18 },
  { day: 4, date: '2026-08-07', targetMarkS: 1.82 },
  { day: 5, date: '2026-08-08', targetMarkS: 4.52 },
]
