// Pure geometry for the preannotation canvas. All numbers are ORIGINAL VIDEO
// PIXELS (origin top-left); CSS pixels are converted at the pointer edge and
// never submitted. Validation mirrors the platform's `invalid_geometry` rules
// so users see problems before the round trip; the server stays authoritative.
// No path aliases here: this module is also imported by node-side specs.

export type Seed = { frame: number; x: number; y: number }
export type Pool = { cx: number; cy: number; radius: number }
export type Point = [number, number]
export type DraftMark = { label: string; polygon: Point[] }
export type Draft = { seed: Seed; pool: Pool; marks: DraftMark[] }
export type Frame = { width: number; height: number; frame_count: number }
export type CandidateGeometry = {
  frame_index: number
  seed: Seed | null
  pool: Pool | null
  marks: { label: string; polygon: Point[] | null }[]
}

export const MAX_MARKS = 64
export const MAX_POINTS = 1024
export const MAX_LABEL = 100

const round2 = (value: number) => Math.round(value * 100) / 100

export function clientToImage(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  frame: Pick<Frame, "width" | "height">,
): Point {
  const x = ((clientX - box.left) / box.width) * frame.width
  const y = ((clientY - box.top) / box.height) * frame.height
  // Server accepts 0 <= x < width, so stay strictly inside the last pixel.
  return [
    round2(Math.min(frame.width - 0.01, Math.max(0, x))),
    round2(Math.min(frame.height - 0.01, Math.max(0, y))),
  ]
}

export function draftFromCandidate(
  candidate: CandidateGeometry,
  frame: Frame,
): Draft {
  const pool = candidate.pool ?? {
    cx: round2(frame.width / 2),
    cy: round2(frame.height / 2),
    radius: round2(Math.min(frame.width, frame.height) * 0.4),
  }
  return {
    pool,
    seed: candidate.seed ?? {
      frame: candidate.frame_index,
      x: pool.cx,
      y: pool.cy,
    },
    // Candidates may lack outlines; those must be drawn by the user.
    marks: candidate.marks.flatMap((mark) =>
      mark.polygon && mark.polygon.length >= 3
        ? [{ label: mark.label, polygon: mark.polygon.map(copyPoint) }]
        : [],
    ),
  }
}

const copyPoint = (point: Point): Point => [point[0], point[1]]

export function clampPool(pool: Pool, frame: Frame): Pool {
  const radius = Math.max(
    1,
    Math.min(pool.radius, frame.width / 2 - 0.01, frame.height / 2 - 0.01),
  )
  return {
    radius: round2(radius),
    cx: round2(
      Math.min(frame.width - radius - 0.01, Math.max(radius, pool.cx)),
    ),
    cy: round2(
      Math.min(frame.height - radius - 0.01, Math.max(radius, pool.cy)),
    ),
  }
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false
  return (
    cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
  )
}

export function polygonSelfIntersects(points: Point[]): boolean {
  const edges = points.map((point, i): [Point, Point] => [
    point,
    points[(i + 1) % points.length],
  ])
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue
      if (segmentsIntersect(...edges[i], ...edges[j])) return true
    }
  }
  return false
}

export function polygonArea(points: Point[]): number {
  return (
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length]
      return sum + a[0] * b[1] - b[0] * a[1]
    }, 0) / 2
  )
}

export function validateMark(mark: DraftMark, frame: Frame): string | null {
  const name = mark.label.trim() || "（未命名）"
  if (!mark.label.trim()) return "标志物名称不能为空"
  if (mark.label.length > MAX_LABEL) return `标志物 ${name} 名称过长`
  const points = mark.polygon
  if (points.length < 3) return `标志物 ${name} 至少需要 3 个点`
  if (points.length > MAX_POINTS) return `标志物 ${name} 点数过多`
  if (
    points.some(
      ([x, y]) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= frame.width ||
        y >= frame.height,
    )
  )
    return `标志物 ${name} 有点落在画面外`
  if (new Set(points.map((p) => `${p[0]},${p[1]}`)).size !== points.length)
    return `标志物 ${name} 有重复的点`
  if (polygonArea(points) === 0) return `标志物 ${name} 面积为 0`
  if (polygonSelfIntersects(points)) return `标志物 ${name} 轮廓自相交`
  return null
}

export function validateDraft(draft: Draft, frame: Frame): string[] {
  const errors: string[] = []
  const { seed, pool } = draft
  const finite = [seed.frame, seed.x, seed.y, pool.cx, pool.cy, pool.radius]
  if (!finite.every(Number.isFinite)) return ["存在无效数值"]
  if (
    !Number.isInteger(seed.frame) ||
    seed.frame < 0 ||
    seed.frame >= frame.frame_count
  )
    errors.push(`起始帧需为 0 到 ${frame.frame_count - 1} 的整数`)
  if (
    seed.x < 0 ||
    seed.y < 0 ||
    seed.x >= frame.width ||
    seed.y >= frame.height
  )
    errors.push("小鼠起点落在画面外")
  if (
    !(pool.radius > 0) ||
    pool.cx - pool.radius < 0 ||
    pool.cy - pool.radius < 0 ||
    pool.cx + pool.radius >= frame.width ||
    pool.cy + pool.radius >= frame.height
  )
    errors.push("水池圆需完整落在画面内")
  if ((seed.x - pool.cx) ** 2 + (seed.y - pool.cy) ** 2 > pool.radius ** 2)
    errors.push("小鼠起点需在水池内")
  if (draft.marks.length > MAX_MARKS) errors.push("标志物过多")
  const labels = new Set<string>()
  for (const mark of draft.marks) {
    if (labels.has(mark.label)) errors.push(`标志物名称重复：${mark.label}`)
    labels.add(mark.label)
    const problem = validateMark(mark, frame)
    if (problem) errors.push(problem)
  }
  return errors
}

export function nextMarkLabel(marks: DraftMark[]): string {
  const used = new Set(marks.map((mark) => mark.label))
  for (let n = marks.length + 1; ; n++) {
    if (!used.has(`标志物 ${n}`)) return `标志物 ${n}`
  }
}
