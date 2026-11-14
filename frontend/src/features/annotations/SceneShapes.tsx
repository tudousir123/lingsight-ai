import { Circle, MousePointer2, Pentagon, Trash2 } from "lucide-react"
import { type PointerEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

export type Point = { x: number; y: number }
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

export function shapeKey(shape: Pick<SceneShape, "kind" | "label">) {
  return `${shape.kind}:${shape.label}`
}

export type ShapeTool = {
  kind: ShapeKind
  mark: MarkLabel
  type: ShapeType
}
export const defaultShapeTool: ShapeTool = {
  kind: "mark",
  mark: "pentacle",
  type: "polygon",
}

export function shapeName(shape: SceneShape) {
  return shape.kind === "mark"
    ? `Mark · ${markLabels[shape.label as MarkLabel] ?? shape.label}`
    : shapeLabels[shape.kind]
}

export function validOutline(points: Point[], type: ShapeType) {
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

export function SceneOverlay({
  width,
  height,
  shapes,
  selected,
  editable,
  canEdit,
  preview,
  tool,
  onSelect,
  onEdit,
}: {
  width: number
  height: number
  shapes: SceneShape[]
  selected: string | null
  editable: boolean
  canEdit: boolean
  preview: Point[]
  tool: ShapeTool
  onSelect: (id: string) => void
  onEdit: (shape: SceneShape) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const moving = useRef<{
    shape: SceneShape
    index: number
    point: Point
  } | null>(null)
  const [transient, setTransient] = useState<SceneShape | null>(null)
  const interactive = editable && canEdit
  const handleRadius = Math.max(width, height) * 0.007
  function move(event: PointerEvent<SVGCircleElement>) {
    const drag = moving.current
    const box = svg.current?.getBoundingClientRect()
    if (!drag || !box) return
    const x = Math.round(((width - 1) * (event.clientX - box.left)) / box.width)
    const y = Math.round(
      ((height - 1) * (event.clientY - box.top)) / box.height,
    )
    drag.point = {
      x: Math.max(0, Math.min(width - 1, x)),
      y: Math.max(0, Math.min(height - 1, y)),
    }
    setTransient({
      ...drag.shape,
      points: drag.shape.points.map((point, index) =>
        index === drag.index ? drag.point : point,
      ),
    })
  }

  return (
    <svg
      ref={svg}
      className="scene-overlay"
      aria-hidden="true"
      viewBox={`0 0 ${width - 1} ${height - 1}`}
      preserveAspectRatio="none"
    >
      {shapes.map((saved) => {
        const id = shapeKey(saved)
        const isSelected = selected === id
        const shape =
          transient && shapeKey(transient) === id ? transient : saved
        return (
          <g
            key={id}
            data-kind={shape.kind}
            data-selected={isSelected || undefined}
          >
            {interactive ? (
              // The shape list provides the keyboard-accessible equivalent.
              <g
                className="scene-select-shape"
                onPointerDown={(event) => {
                  if (event.button === 0) onSelect(id)
                }}
              >
                {outline(shape.points, shape.shape_type, true)}
              </g>
            ) : (
              outline(shape.points, shape.shape_type, true)
            )}
            {interactive &&
              isSelected &&
              shape.points.map((point, index) => (
                <circle
                  key={index}
                  className="scene-handle"
                  cx={point.x}
                  cy={point.y}
                  r={handleRadius}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    moving.current = {
                      shape: saved,
                      index,
                      point: saved.points[index],
                    }
                  }}
                  onPointerMove={move}
                  onPointerUp={() => {
                    const drag = moving.current
                    moving.current = null
                    setTransient(null)
                    if (!drag) return
                    const before = drag.shape.points[drag.index]
                    if (before.x === drag.point.x && before.y === drag.point.y)
                      return
                    const points = drag.shape.points.map((point, index) =>
                      index === drag.index ? drag.point : point,
                    )
                    if (validOutline(points, drag.shape.shape_type))
                      onEdit({ ...drag.shape, points })
                  }}
                  onPointerCancel={() => {
                    moving.current = null
                    setTransient(null)
                  }}
                />
              ))}
          </g>
        )
      })}
      {!!preview.length && (
        <g className="scene-preview" data-kind={tool.kind}>
          {outline(preview, tool.type, false)}
          {preview
            .slice(0, tool.type === "circle" ? 1 : undefined)
            .map((point, index) => (
              <circle
                key={index}
                className="scene-vertex"
                cx={point.x}
                cy={point.y}
                r={handleRadius / 2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </g>
      )}
    </svg>
  )
}

export function SceneControls({
  tool,
  editing,
  canEdit,
  pending,
  shapes,
  selected,
  onTool,
  onEditMode,
  onSelect,
  onFinish,
  onCancel,
  onDelete,
}: {
  tool: ShapeTool
  editing: boolean
  canEdit: boolean
  pending: number
  shapes: SceneShape[]
  selected: string | null
  onTool: (tool: ShapeTool) => void
  onEditMode: () => void
  onSelect: (id: string) => void
  onFinish: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="scene-controls">
      <fieldset className="scene-tools" aria-label="场景标注对象">
        {(Object.keys(shapeLabels) as ShapeKind[]).map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={!editing && tool.kind === kind}
            onClick={() =>
              onTool({
                ...tool,
                kind,
                type: kind === "mark" ? "polygon" : "circle",
              })
            }
          >
            {shapeLabels[kind]}
          </Button>
        ))}
      </fieldset>
      <p>同一视频的场景轮廓在各帧共用。</p>
      {!editing && (
        <div className="scene-options">
          {tool.kind === "mark" && (
            <label>
              Mark 类型
              <select
                value={tool.mark}
                onChange={(event) =>
                  onTool({ ...tool, mark: event.target.value as MarkLabel })
                }
              >
                {Object.entries(markLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="scene-tools" aria-label="绘图工具">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={tool.type === "polygon"}
              onClick={() => onTool({ ...tool, type: "polygon" })}
            >
              <Pentagon /> 多边形
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={tool.type === "circle"}
              onClick={() => onTool({ ...tool, type: "circle" })}
            >
              <Circle /> 圆形
            </Button>
          </fieldset>
          <p>
            {tool.type === "circle"
              ? "依次点击圆心和边缘。"
              : "沿边缘点击，按 Enter 或「闭合轮廓」完成。"}
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onCancel}
              >
                取消绘制
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="annotation-frames scene-list">
        <div className="annotation-section-title">
          <h3>场景轮廓</h3>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            aria-pressed={editing}
            onClick={onEditMode}
          >
            <MousePointer2 /> 编辑轮廓
          </Button>
        </div>
        <ul>
          {shapes.map((shape) => (
            <li key={shapeKey(shape)}>
              <button
                type="button"
                data-kind={shape.kind}
                aria-current={selected === shapeKey(shape) ? "true" : undefined}
                onClick={() => onSelect(shapeKey(shape))}
              >
                <i className="scene-swatch" aria-hidden="true" />
                <span>{shapeName(shape)}</span>
              </button>
            </li>
          ))}
        </ul>
        {editing && (
          <>
            <p>选中轮廓后拖动控制点，可按 Delete 删除。</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!canEdit || !selected}
              onClick={onDelete}
            >
              <Trash2 /> 删除轮廓
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
