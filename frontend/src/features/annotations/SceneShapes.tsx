import { Eye, EyeOff, Trash2 } from "lucide-react"
import { type PointerEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

import {
  circleFromRim,
  imagePoint,
  type Point,
  translateOutline,
} from "./shapeGeometry"

export type { Point } from "./shapeGeometry"
export type ShapeKind = "mark" | "platform" | "pool"
type ShapeType = "polygon" | "circle"

export type SceneShape = {
  kind: ShapeKind
  label: string
  shape_type: ShapeType
  points: Point[]
  frameIndex: number | null
  timeMs: number
}

export const pointLabels = { head: "头点", tail: "尾点", center: "质心" }
export type Landmark = keyof typeof pointLabels
export type CanvasAnnotation =
  | SceneShape
  | {
      kind: "point"
      label: Landmark
      shape_type: "point"
      points: Point[]
      timeMs: number
    }

export const shapeLabels = {
  mark: "Mark",
  platform: "平台",
  pool: "水池边缘",
} as const
export const markLabels = {
  pentacle: "五角星",
  rectangle: "矩形",
  triangle: "三角形",
  round: "圆形",
} as const
export type MarkLabel = keyof typeof markLabels

export function pointKey(label: Landmark, timeMs: number) {
  return `point:${label}:${timeMs}`
}

export function shapeKey(shape: CanvasAnnotation) {
  return shape.kind === "point"
    ? pointKey(shape.label, shape.timeMs)
    : `${shape.kind}:${shape.label}`
}

export type ShapeTool = {
  kind: ShapeKind
  mark: MarkLabel
  type: ShapeType
  circleMode?: "center" | "rim"
}
export const defaultShapeTool: ShapeTool = {
  kind: "mark",
  mark: "pentacle",
  type: "polygon",
}

function annotationName(shape: CanvasAnnotation) {
  if (shape.kind === "point") return pointLabels[shape.label]
  return shape.kind === "mark"
    ? `Mark · ${markLabels[shape.label as MarkLabel] ?? shape.label}`
    : shapeLabels[shape.kind]
}

export function validOutline(
  points: Point[],
  type: CanvasAnnotation["shape_type"],
) {
  if (type === "point") return points.length === 1
  if (type === "circle") {
    return (
      points.length === 2 &&
      Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) > 1
    )
  }
  if (points.length < 3) return false
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - point.y * next.x
  }, 0)
  return Math.abs(area) > 2
}

function outline(points: Point[], type: ShapeType, closed: boolean) {
  if (!points.length) return null
  if (type === "circle") {
    const [center, rim] = points
    return (
      <circle
        cx={center.x}
        cy={center.y}
        r={rim ? Math.hypot(rim.x - center.x, rim.y - center.y) : 2}
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  const path = points.map(({ x, y }) => `${x},${y}`).join(" ")
  return closed ? (
    <polygon points={path} vectorEffect="non-scaling-stroke" />
  ) : (
    <polyline points={path} vectorEffect="non-scaling-stroke" />
  )
}

export function AnnotationOverlay({
  width,
  height,
  scale,
  shapes,
  selected,
  editable,
  canEdit,
  preview,
  cursor,
  snap,
  tool,
  onSelect,
  onEdit,
}: {
  width: number
  height: number
  scale: number
  shapes: CanvasAnnotation[]
  selected: string | null
  editable: boolean
  canEdit: boolean
  preview: Point[]
  cursor: Point | null
  snap: boolean
  tool: ShapeTool
  onSelect: (id: string) => void
  onEdit: (shape: CanvasAnnotation) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const moving = useRef<{
    shape: CanvasAnnotation
    index: number | null
    start: Point
    points: Point[]
  } | null>(null)
  const [transient, setTransient] = useState<CanvasAnnotation | null>(null)
  const interactive = editable && canEdit
  const handleRadius = (Math.max(width, height) * 0.007) / scale
  const drawPoints = cursor ? [...preview, cursor] : preview
  const rimPreview = tool.type === "circle" && tool.circleMode === "rim"
  const candidateCircle =
    rimPreview && drawPoints.length === 3 ? circleFromRim(drawPoints) : null

  function position(event: PointerEvent<SVGElement>) {
    const box = svg.current?.getBoundingClientRect()
    return (
      box &&
      imagePoint({ x: event.clientX, y: event.clientY }, box, width, height)
    )
  }

  function begin(
    event: PointerEvent<SVGElement>,
    shape: CanvasAnnotation,
    index: number | null,
  ) {
    if (event.button !== 0) return
    const start = position(event)
    if (!start) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    moving.current = { shape, index, start, points: shape.points }
    onSelect(shapeKey(shape))
  }

  function move(event: PointerEvent<SVGElement>) {
    const drag = moving.current
    const point = position(event)
    if (!drag || !point) return
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y }
    drag.points =
      drag.index === null ||
      (drag.shape.shape_type === "circle" && drag.index === 0)
        ? translateOutline(drag.shape.points, delta, width, height)
        : drag.shape.points.map((previous, index) =>
            index === drag.index ? point : previous,
          )
    setTransient({ ...drag.shape, points: drag.points })
  }

  function end(commit: boolean) {
    const drag = moving.current
    moving.current = null
    setTransient(null)
    if (
      commit &&
      drag?.points.some(
        (point, index) =>
          point.x !== drag.shape.points[index].x ||
          point.y !== drag.shape.points[index].y,
      ) &&
      validOutline(drag.points, drag.shape.shape_type)
    ) {
      onEdit({ ...drag.shape, points: drag.points })
    }
  }

  return (
    <svg
      ref={svg}
      className="scene-overlay"
      aria-hidden="true"
      viewBox={`0 0 ${Math.max(1, width - 1)} ${Math.max(1, height - 1)}`}
      preserveAspectRatio="none"
    >
      {shapes.map((saved) => {
        const id = shapeKey(saved)
        const isSelected = selected === id
        const shape =
          transient && shapeKey(transient) === id ? transient : saved
        const geometry =
          shape.kind === "point" ? (
            <circle
              className="annotation-point"
              cx={shape.points[0].x}
              cy={shape.points[0].y}
              r={handleRadius * 0.75}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            outline(shape.points, shape.shape_type, true)
          )
        return (
          <g
            key={id}
            data-kind={shape.kind}
            data-label={shape.label}
            data-selected={isSelected || undefined}
          >
            {interactive ? (
              <g
                className="scene-select-shape"
                data-fill-hit={shape.kind !== "pool" || undefined}
                onPointerDown={(event) => begin(event, saved, null)}
                onPointerMove={move}
                onPointerUp={() => end(true)}
                onPointerCancel={() => end(false)}
              >
                {geometry}
              </g>
            ) : (
              geometry
            )}
            {interactive &&
              isSelected &&
              shape.kind !== "point" &&
              shape.points.map((point, index) => (
                <circle
                  key={index}
                  className="scene-handle"
                  cx={point.x}
                  cy={point.y}
                  r={handleRadius}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => begin(event, saved, index)}
                  onPointerMove={move}
                  onPointerUp={() => end(true)}
                  onPointerCancel={() => end(false)}
                />
              ))}
          </g>
        )
      })}
      {!!preview.length && (
        <g className="scene-preview" data-kind={tool.kind}>
          {candidateCircle
            ? outline(candidateCircle, "circle", true)
            : outline(drawPoints, rimPreview ? "polygon" : tool.type, false)}
          {preview.map((point, index) => (
            <circle
              key={index}
              className="scene-vertex"
              data-snap={(index === 0 && snap) || undefined}
              cx={point.x}
              cy={point.y}
              r={index === 0 && snap ? handleRadius : handleRadius / 2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
    </svg>
  )
}

export function ShapeOptions({
  tool,
  canEdit,
  pending,
  onTool,
  onFinish,
  onCancel,
}: {
  tool: ShapeTool
  canEdit: boolean
  pending: number
  onTool: (tool: ShapeTool) => void
  onFinish: () => void
  onCancel: () => void
}) {
  return (
    <div className="scene-options">
      {tool.type === "circle" && (
        <label>
          定圆方式
          <select
            value={tool.circleMode ?? "center"}
            onChange={(event) =>
              onTool({
                ...tool,
                circleMode: event.target.value === "rim" ? "rim" : "center",
              })
            }
          >
            <option value="center">圆心 + 边缘</option>
            <option value="rim">三点定圆</option>
          </select>
        </label>
      )}
      <p>
        {tool.type === "polygon"
          ? "沿轮廓落点，回到起点或按 Enter 闭合。"
          : tool.circleMode === "rim"
            ? "沿边缘点三个分散的位置。"
            : "依次点击圆心和边缘。"}
      </p>
      {!!pending && (
        <div className="annotation-actions">
          {tool.type === "polygon" && (
            <Button
              type="button"
              size="sm"
              disabled={pending < 3 || !canEdit}
              onClick={onFinish}
            >
              闭合轮廓
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            取消绘制
          </Button>
        </div>
      )}
    </div>
  )
}

export function AnnotationList({
  shapes,
  selected,
  hidden,
  canEdit,
  onSelect,
  onDelete,
  onToggle,
}: {
  shapes: CanvasAnnotation[]
  selected: string | null
  hidden: string[]
  canEdit: boolean
  onSelect: (id: string) => void
  onDelete: () => void
  onToggle: (id: string) => void
}) {
  return (
    <div className="annotation-frames scene-list">
      <div className="annotation-section-title">
        <h3>标注列表</h3>
        <span>{shapes.length} 个</span>
      </div>
      <ul aria-label="标注列表">
        {shapes.map((shape) => {
          const id = shapeKey(shape)
          const name = annotationName(shape)
          const invisible = hidden.includes(id)
          return (
            <li key={id}>
              <button
                className="scene-row-select"
                type="button"
                data-kind={shape.kind}
                data-label={shape.label}
                aria-label={name}
                aria-current={selected === id ? "true" : undefined}
                onClick={() => onSelect(id)}
              >
                <i className="scene-swatch" aria-hidden="true" />
                <span>{name}</span>
                <span>{shape.kind === "point" ? "本帧" : "整段"}</span>
              </button>
              <Button
                variant="ghost"
                type="button"
                size="icon-sm"
                aria-label={`${invisible ? "显示" : "隐藏"}${name}`}
                onClick={() => onToggle(id)}
              >
                {invisible ? <EyeOff /> : <Eye />}
              </Button>
            </li>
          )
        })}
      </ul>
      {!shapes.length && <p>暂无标注</p>}
      {selected && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canEdit}
          aria-keyshortcuts="Delete"
          title="Delete"
          onClick={onDelete}
        >
          <Trash2 /> 删除标注
        </Button>
      )}
    </div>
  )
}
