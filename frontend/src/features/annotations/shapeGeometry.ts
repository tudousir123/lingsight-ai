export type Point = { x: number; y: number }

export function imagePoint(
  cursor: Point,
  box: DOMRect,
  width: number,
  height: number,
): Point {
  const x = Math.round(((cursor.x - box.left) * (width - 1)) / box.width)
  const y = Math.round(((cursor.y - box.top) * (height - 1)) / box.height)
  return {
    x: Math.max(0, Math.min(width - 1, x)),
    y: Math.max(0, Math.min(height - 1, y)),
  }
}

export function circleFromRim([a, b, c]: Point[]): Point[] | null {
  const bx = b.x - a.x
  const by = b.y - a.y
  const cx = c.x - a.x
  const cy = c.y - a.y
  const determinant = 2 * (bx * cy - by * cx)
  if (Math.abs(determinant) <= 2) return null
  const b2 = bx ** 2 + by ** 2
  const c2 = cx ** 2 + cy ** 2
  return [
    {
      x: a.x + (cy * b2 - by * c2) / determinant,
      y: a.y + (bx * c2 - cx * b2) / determinant,
    },
    c,
  ]
}

export function translateOutline(
  points: Point[],
  delta: Point,
  width: number,
  height: number,
) {
  const dx = Math.max(
    -Math.min(...points.map((point) => point.x)),
    Math.min(width - 1 - Math.max(...points.map((point) => point.x)), delta.x),
  )
  const dy = Math.max(
    -Math.min(...points.map((point) => point.y)),
    Math.min(height - 1 - Math.max(...points.map((point) => point.y)), delta.y),
  )
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
}
