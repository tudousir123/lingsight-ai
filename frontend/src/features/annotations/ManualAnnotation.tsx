import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Dot,
  Download,
  FolderOpen,
  MousePointer2,
  Pause,
  Pentagon,
  Play,
  RotateCcw,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { AnnotationViewport } from "./AnnotationViewport"
import {
  AnnotationList,
  AnnotationOverlay,
  type CanvasAnnotation,
  defaultShapeTool,
  type Landmark,
  type MarkLabel,
  markLabels,
  type Point,
  pointKey,
  pointLabels,
  type SceneShape,
  ShapeOptions,
  type ShapeTool,
  shapeKey,
  shapeLabels,
  validOutline,
} from "./SceneShapes"
import { circleFromRim, imagePoint } from "./shapeGeometry"
import "./manual-annotation.css"

type Frame = {
  timeMs: number
  frameIndex: number | null
  points: Partial<Record<Landmark, Point>>
}
type Draft = {
  fps: number | null
  frames: Record<number, Frame>
  shapes: SceneShape[]
}
type Change =
  | { kind: "frame"; key: number; frame?: Frame }
  | { kind: "scene"; shapes: SceneShape[] }
type Source = {
  key: string
  name: string
  url: string
  kind: "local" | "example"
  fps?: number
}
const landmarks = Object.keys(pointLabels) as Landmark[]
const exampleUrl = import.meta.env.VITE_MOCK_ANNOTATION_VIDEO_URL
const example: Source | null = exampleUrl
  ? {
      key: "water-maze-example-v1",
      name: "水迷宫示例.mp4",
      url: exampleUrl,
      kind: "example",
      fps: 24,
    }
  : null

function clamp(value: number, max: number) {
  return Math.min(max, Math.max(0, value))
}

function readDraft(key: string, fps?: number): Draft {
  const empty: Draft = { fps: fps ?? null, frames: {}, shapes: [] }
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const value = JSON.parse(saved)
      if (
        (value.version === 1 || value.version === 2) &&
        value.frames &&
        typeof value.frames === "object"
      ) {
        return {
          fps: value.fps ?? null,
          frames: value.frames,
          shapes: Array.isArray(value.shapes) ? value.shapes : [],
        }
      }
    }
  } catch {
    // A fresh draft remains available if browser storage is unavailable.
  }
  return empty
}

export function ManualAnnotation({ active }: { active: boolean }) {
  const { user } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<Source | null>(example)
  const [error, setError] = useState("")

  useEffect(() => {
    if (source?.kind === "local") return () => URL.revokeObjectURL(source.url)
  }, [source])

  return (
    <section className="manual-annotation" aria-label="手动标注工作区">
      <header className="annotation-source">
        <div>
          <h2>{source?.name ?? "选择要标注的视频"}</h2>
          {source && (
            <p>{source.kind === "example" ? "水迷宫合成示例" : "本地视频"}</p>
          )}
        </div>
        <div className="annotation-actions">
          {example && source?.kind !== "example" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setError("")
                setSource(example)
              }}
            >
              打开示例
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => input.current?.click()}
          >
            <FolderOpen /> 打开本地视频
          </Button>
          <input
            ref={input}
            type="file"
            accept="video/*,.mkv,.mts"
            aria-label="选择本地标注视频"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (!file) return
              if (
                !file.type.startsWith("video/") &&
                !/\.(mp4|mov|m4v|avi|mkv|webm|mts)$/i.test(file.name)
              ) {
                setError("请选择视频文件。")
                return
              }
              setError("")
              setSource({
                key: JSON.stringify([file.name, file.size, file.lastModified]),
                name: file.name,
                url: URL.createObjectURL(file),
                kind: "local",
              })
            }}
          />
        </div>
      </header>
      {error && (
        <p role="alert" className="annotation-error">
          {error}
        </p>
      )}
      {source ? (
        <AnnotationEditor
          key={JSON.stringify([user?.id, source.url])}
          source={source}
          active={active}
          storageKey={
            user ? `lingsight.annotation.v1:${user.id}:${source.key}` : null
          }
        />
      ) : (
        <div className="annotation-empty">
          <p>打开实验录像，标记小鼠关键点、Mark、平台和水池边缘。</p>
        </div>
      )}
    </section>
  )
}

function AnnotationEditor({
  source,
  active,
  storageKey,
}: {
  source: Source
  active: boolean
  storageKey: string | null
}) {
  const media = useRef<HTMLVideoElement>(null)
  const [meta, setMeta] = useState<{
    width: number
    height: number
    duration: number
  } | null>(null)
  const [draft, setDraft] = useState<Draft>(() =>
    storageKey
      ? readDraft(storageKey, source.fps)
      : { fps: source.fps ?? null, frames: {}, shapes: [] },
  )
  const [fpsInput, setFpsInput] = useState(draft.fps?.toString() ?? "")
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!active) media.current?.pause()
  }, [active])
  const [seeking, setSeeking] = useState(false)
  const [error, setError] = useState("")
  const [saveFailed, setSaveFailed] = useState(false)
  const [undo, setUndo] = useState<Change[]>([])
  const [mode, setMode] = useState<"points" | "draw" | "edit">("points")
  const [tool, setTool] = useState<ShapeTool>(defaultShapeTool)
  const [outline, setOutline] = useState<Point[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [snap, setSnap] = useState(false)
  const [hiddenShapes, setHiddenShapes] = useState<string[]>([])
  const [shapeError, setShapeError] = useState("")
  const canvas = useRef<HTMLButtonElement>(null)
  const [landmark, setLandmark] = useState<Landmark>("head")
  const { fps } = draft
  const lastFrame =
    meta && fps ? Math.max(0, Math.ceil(meta.duration * fps - 0.001) - 1) : null
  const frameIndex =
    fps && lastFrame !== null
      ? clamp(Math.floor(time * fps + 0.001), lastFrame)
      : null
  const selectedTime = meta
    ? clamp(time, Math.max(0, meta.duration - 0.001))
    : time
  const timeMs = Math.round(
    1000 * (frameIndex !== null && fps ? frameIndex / fps : selectedTime),
  )
  const current = draft.frames[timeMs]
  const frames = Object.values(draft.frames).sort((a, b) => a.timeMs - b.timeMs)
  const canMark = !!meta && ready && paused && !seeking && !error
  const framePoints: CanvasAnnotation[] = []
  for (const label of landmarks) {
    const point = current?.points[label]
    if (point) {
      framePoints.push({
        kind: "point",
        label,
        shape_type: "point",
        points: [point],
        timeMs,
      })
    }
  }
  const annotations = [...draft.shapes, ...framePoints]
  const selectedAnnotation = annotations.find(
    (shape) => shapeKey(shape) === selected,
  )
  const target =
    mode === "points" ||
    (mode === "edit" && selectedAnnotation?.kind === "point")
      ? landmark
      : tool.kind === "mark"
        ? tool.mark
        : tool.kind
  const drawLabel = shapeLabels[tool.kind]

  function persist(next: Draft) {
    setDraft(next)
    try {
      if (!storageKey) throw new Error()
      localStorage.setItem(storageKey, JSON.stringify({ version: 2, ...next }))
      setSaveFailed(false)
    } catch {
      setSaveFailed(true)
    }
  }

  function updateFrame(key: number, frame?: Frame) {
    const next = { ...draft.frames }
    if (frame) next[key] = frame
    else delete next[key]
    persist({ ...draft, frames: next })
  }

  function setPoint(point: Point, label = landmark) {
    if (!canMark || !meta || media.current?.seeking) return
    const next = {
      x: clamp(Math.round(point.x), meta.width - 1),
      y: clamp(Math.round(point.y), meta.height - 1),
    }
    if (
      current?.points[label]?.x === next.x &&
      current.points[label]?.y === next.y
    )
      return
    setUndo([...undo, { kind: "frame", key: timeMs, frame: current }])
    updateFrame(timeMs, {
      timeMs,
      frameIndex,
      points: { ...current?.points, [label]: next },
    })
  }

  function cancelOutline() {
    setOutline([])
    setCursor(null)
    setSnap(false)
    setShapeError("")
  }

  function changeTool(next: ShapeTool, focusCanvas = true) {
    cancelOutline()
    setTool(next)
    setMode("draw")
    setSelected(null)
    if (focusCanvas) canvas.current?.focus({ preventScroll: true })
  }

  function pointMode(label = landmark, focusCanvas = true) {
    cancelOutline()
    setLandmark(label)
    setMode("points")
    setSelected(null)
    setHiddenShapes((hidden) =>
      hidden.filter((id) => id !== pointKey(label, timeMs)),
    )
    if (focusCanvas) canvas.current?.focus({ preventScroll: true })
  }

  function chooseTarget(value: string) {
    if (value === "head" || value === "tail" || value === "center") {
      pointMode(value, false)
    } else if (value === "platform" || value === "pool") {
      changeTool(
        {
          ...tool,
          kind: value,
          type: "circle",
          circleMode: value === "pool" ? "rim" : "center",
        },
        false,
      )
    } else {
      changeTool(
        {
          ...tool,
          kind: "mark",
          mark: value as MarkLabel,
          type: "polygon",
        },
        false,
      )
    }
  }

  function selectShape(
    key: string,
    shape = annotations.find((annotation) => shapeKey(annotation) === key),
  ) {
    cancelOutline()
    setMode("edit")
    setSelected(key)
    if (shape?.kind === "point") {
      setLandmark(shape.label)
    } else if (shape) {
      setTool({
        ...tool,
        kind: shape.kind,
        type: shape.shape_type,
        mark: shape.kind === "mark" ? (shape.label as MarkLabel) : tool.mark,
        circleMode: shape.kind === "pool" ? "rim" : "center",
      })
    }
    setHiddenShapes((hidden) => hidden.filter((id) => id !== key))
    canvas.current?.focus({ preventScroll: true })
  }

  function saveShapes(shapes: SceneShape[]) {
    setUndo([...undo, { kind: "scene", shapes: draft.shapes }])
    persist({ ...draft, shapes })
  }

  function updateShape(shape: CanvasAnnotation) {
    if (!canMark || media.current?.seeking) return
    if (shape.kind === "point") {
      if (shape.timeMs === timeMs) setPoint(shape.points[0], shape.label)
      return
    }
    const id = shapeKey(shape)
    const exists = draft.shapes.some((item) => shapeKey(item) === id)
    saveShapes(
      exists
        ? draft.shapes.map((item) => (shapeKey(item) === id ? shape : item))
        : [...draft.shapes, shape],
    )
  }

  function shouldSnap(clientX: number, clientY: number, box: DOMRect) {
    if (!meta || tool.type !== "polygon" || outline.length < 3) return false
    const first = outline[0]
    const x = box.left + (first.x * box.width) / Math.max(1, meta.width - 1)
    const y = box.top + (first.y * box.height) / Math.max(1, meta.height - 1)
    return Math.hypot(clientX - x, clientY - y) <= 10
  }

  function finishOutline(points = outline) {
    if (!canMark) return
    if (!validOutline(points, tool.type)) {
      setShapeError("轮廓太小或点重合，请重新落点。")
      return
    }
    const label = tool.kind === "mark" ? tool.mark : tool.kind
    const shape = {
      kind: tool.kind,
      label,
      shape_type: tool.type,
      points,
      timeMs,
      frameIndex,
    }
    updateShape(shape)
    selectShape(shapeKey(shape), shape)
  }

  function editMode() {
    cancelOutline()
    setMode("edit")
    canvas.current?.focus({ preventScroll: true })
  }

  function toggleShape(id: string) {
    const isHidden = hiddenShapes.includes(id)
    setHiddenShapes(
      isHidden
        ? hiddenShapes.filter((key) => key !== id)
        : [...hiddenShapes, id],
    )
    if (!isHidden && selected === id) setSelected(null)
  }

  function deleteShape() {
    if (!canMark || media.current?.seeking || !selectedAnnotation) return
    if (selectedAnnotation.kind === "point" && current) {
      const points = { ...current.points }
      delete points[selectedAnnotation.label]
      setUndo([...undo, { kind: "frame", key: timeMs, frame: current }])
      updateFrame(
        timeMs,
        Object.keys(points).length ? { ...current, points } : undefined,
      )
    } else {
      saveShapes(draft.shapes.filter((shape) => shapeKey(shape) !== selected))
    }
    setSelected(null)
  }

  function undoChange() {
    if (!canMark) return
    const last = undo[undo.length - 1]
    if (!last) return
    cancelOutline()
    if (last.kind === "scene") {
      persist({ ...draft, shapes: last.shapes })
      if (
        selectedAnnotation?.kind !== "point" &&
        !last.shapes.some((shape) => shapeKey(shape) === selected)
      )
        setSelected(null)
    } else {
      updateFrame(last.key, last.frame)
      if (last.key !== timeMs) seek(last.key / 1000 + (fps ? 0.1 / fps : 0))
    }
    setUndo(undo.slice(0, -1))
  }

  function seek(seconds: number) {
    if (!media.current || !meta || !Number.isFinite(seconds)) return
    cancelOutline()
    if (selectedAnnotation?.kind === "point") setSelected(null)
    media.current.pause()
    media.current.currentTime = clamp(
      seconds,
      Math.max(0, meta.duration - 0.001),
    )
    setTime(media.current.currentTime)
  }

  function step(delta: number) {
    if (!fps || frameIndex === null || lastFrame === null) return
    seek((clamp(frameIndex + delta, lastFrame) + 0.1) / fps)
  }

  function exportDraft() {
    if (!meta || (!frames.length && !draft.shapes.length)) return
    const content = JSON.stringify(
      {
        version: 2,
        video: {
          name: source.name,
          source: source.kind,
          width: meta.width,
          height: meta.height,
          fps,
          durationSeconds: meta.duration,
        },
        frames,
        sceneShapes: draft.shapes.map(({ points, ...shape }) => ({
          ...shape,
          points: points.map(({ x, y }) => [x, y]),
        })),
      },
      null,
      2,
    )
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${source.name.replace(/\.[^.]+$/, "")}.annotations.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="annotation-grid">
      <div className="annotation-player">
        <div className="annotation-drawing-bar">
          <fieldset className="scene-tools" aria-label="标注工具">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={mode === "edit"}
              onClick={editMode}
            >
              <MousePointer2 /> 选择
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={mode === "points"}
              onClick={() => pointMode()}
            >
              <Dot /> 点
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={mode === "draw" && tool.type === "circle"}
              onClick={() => changeTool({ ...tool, type: "circle" })}
            >
              <Circle /> 圆形
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={mode === "draw" && tool.type === "polygon"}
              onClick={() => changeTool({ ...tool, type: "polygon" })}
            >
              <Pentagon /> 多边形
            </Button>
          </fieldset>
        </div>
        <AnnotationViewport width={meta?.width} height={meta?.height}>
          {(panning, scale) => (
            <>
              <video
                ref={media}
                src={source.url}
                preload="auto"
                playsInline
                aria-label="标注视频"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  if (
                    video.videoWidth &&
                    Number.isFinite(video.duration) &&
                    video.duration > 0
                  ) {
                    setMeta({
                      width: video.videoWidth,
                      height: video.videoHeight,
                      duration: video.duration,
                    })
                  }
                }}
                onError={() =>
                  setError(
                    "无法播放该视频，请尝试浏览器支持的 MP4 或 WebM 文件。",
                  )
                }
                onLoadedData={() => setReady(true)}
                onPlay={() => {
                  cancelOutline()
                  if (selectedAnnotation?.kind === "point") setSelected(null)
                  setPaused(false)
                }}
                onPause={() => setPaused(true)}
                onEnded={() => setPaused(true)}
                onSeeking={() => setSeeking(true)}
                onSeeked={(event) => {
                  setTime(event.currentTarget.currentTime)
                  setSeeking(false)
                }}
                onTimeUpdate={(event) =>
                  setTime(event.currentTarget.currentTime)
                }
              >
                <track kind="captions" />
              </video>
              {meta && (
                <button
                  ref={canvas}
                  type="button"
                  className="annotation-hit"
                  data-mode={mode}
                  aria-label={
                    mode === "points"
                      ? `画面标注：${pointLabels[landmark]}`
                      : mode === "draw"
                        ? `绘制${drawLabel}`
                        : "标注编辑画布"
                  }
                  disabled={!canMark}
                  onPointerMove={(event) => {
                    if (
                      mode !== "draw" ||
                      panning ||
                      !canMark ||
                      !outline.length
                    )
                      return
                    const box = event.currentTarget.getBoundingClientRect()
                    const point = imagePoint(
                      { x: event.clientX, y: event.clientY },
                      box,
                      meta.width,
                      meta.height,
                    )
                    const closes = shouldSnap(event.clientX, event.clientY, box)
                    setSnap(closes)
                    setCursor(closes ? outline[0] : point)
                  }}
                  onPointerLeave={() => {
                    setCursor(null)
                    setSnap(false)
                  }}
                  onClick={(event) => {
                    if (event.detail === 0 || panning || media.current?.seeking)
                      return
                    const box = event.currentTarget.getBoundingClientRect()
                    const point = imagePoint(
                      { x: event.clientX, y: event.clientY },
                      box,
                      meta.width,
                      meta.height,
                    )
                    if (mode === "points") {
                      setPoint(point)
                      return
                    }
                    if (mode === "edit") {
                      setSelected(null)
                      return
                    }
                    if (
                      shouldSnap(event.clientX, event.clientY, box) ||
                      (tool.type === "polygon" &&
                        outline.length >= 3 &&
                        event.detail === 2)
                    ) {
                      finishOutline()
                      return
                    }
                    const previous = outline[outline.length - 1]
                    if (previous?.x === point.x && previous.y === point.y)
                      return
                    const points = [...outline, point]
                    setCursor(null)
                    setSnap(false)
                    if (tool.type === "circle") {
                      const fromRim = tool.circleMode === "rim"
                      if (
                        (!fromRim && points.length === 2) ||
                        (fromRim && points.length === 3)
                      ) {
                        const circle = fromRim ? circleFromRim(points) : points
                        if (circle && validOutline(circle, "circle"))
                          finishOutline(circle)
                        else
                          setShapeError(
                            fromRim
                              ? "三个点不能在一条直线上，请换一个边缘点。"
                              : "请点击离圆心更远的边缘。",
                          )
                        return
                      }
                    }
                    setShapeError("")
                    setOutline(points)
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key.toLowerCase() === "z"
                    ) {
                      event.preventDefault()
                      if (outline.length) {
                        setOutline(outline.slice(0, -1))
                        setCursor(null)
                        setSnap(false)
                      } else undoChange()
                      return
                    }
                    if (mode === "draw") {
                      if (event.key === "Escape") cancelOutline()
                      if (
                        (event.key === "Enter" || event.key === " ") &&
                        tool.type === "polygon" &&
                        outline.length >= 3
                      ) {
                        event.preventDefault()
                        finishOutline()
                      }
                      return
                    }
                    if (mode === "edit") {
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault()
                        deleteShape()
                      }
                      return
                    }
                    const point = current?.points[landmark] ?? {
                      x: (meta.width - 1) / 2,
                      y: (meta.height - 1) / 2,
                    }
                    const delta = {
                      ArrowUp: [0, -1],
                      ArrowDown: [0, 1],
                      ArrowLeft: [-1, 0],
                      ArrowRight: [1, 0],
                      Enter: [0, 0],
                    }[event.key]
                    if (!delta) return
                    event.preventDefault()
                    const stride = event.shiftKey ? 10 : 1
                    setPoint({
                      x: point.x + delta[0] * stride,
                      y: point.y + delta[1] * stride,
                    })
                  }}
                />
              )}
              {meta && (
                <AnnotationOverlay
                  width={meta.width}
                  height={meta.height}
                  scale={scale}
                  shapes={annotations.filter(
                    (shape) =>
                      !hiddenShapes.includes(shapeKey(shape)) &&
                      (shape.kind !== "point" || (paused && !seeking)),
                  )}
                  selected={mode === "edit" ? selected : null}
                  editable={mode === "edit"}
                  canEdit={canMark && !panning}
                  cursor={mode === "draw" && !panning ? cursor : null}
                  snap={snap}
                  preview={mode === "draw" ? outline : []}
                  tool={tool}
                  onSelect={selectShape}
                  onEdit={updateShape}
                />
              )}
            </>
          )}
        </AnnotationViewport>
        {error && (
          <p role="alert" className="annotation-error">
            {error}
          </p>
        )}
        <div className="annotation-transport">
          <div className="annotation-actions">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={!meta}
              aria-label={paused ? "播放" : "暂停"}
              onClick={() => {
                if (media.current?.paused)
                  void media.current
                    .play()
                    .catch(() => setError("播放失败，请重新打开视频。"))
                else media.current?.pause()
              }}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="上一帧"
              title="上一帧"
              disabled={frameIndex === null || frameIndex === 0 || seeking}
              onClick={() => step(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="下一帧"
              title="下一帧"
              disabled={
                frameIndex === null || frameIndex === lastFrame || seeking
              }
              onClick={() => step(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <input
            type="range"
            aria-label="视频进度"
            min={0}
            max={meta?.duration ?? 0}
            step={0.001}
            value={time}
            disabled={!meta}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="annotation-time">
            {(timeMs / 1000).toFixed(3)} s
            {frameIndex !== null && ` · 第 ${frameIndex + 1} 帧`}
          </span>
        </div>
      </div>
      <aside className="annotation-inspector" aria-label="标注面板">
        <div className="scene-options">
          <label>
            标注对象
            <select
              value={target}
              onChange={(event) => chooseTarget(event.target.value)}
            >
              {Object.entries(pointLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {Object.entries(markLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  Mark · {label}
                </option>
              ))}
              <option value="platform">{shapeLabels.platform}</option>
              <option value="pool">{shapeLabels.pool}</option>
            </select>
          </label>
          {!paused && <p>暂停视频后即可标注。</p>}
          {paused && mode === "points" && (
            <p>点击画面放置{pointLabels[landmark]}。</p>
          )}
          {paused && mode === "edit" && (
            <p>拖动标注移动，拖动轮廓控制点调整形状。</p>
          )}
        </div>
        {mode === "draw" && (
          <ShapeOptions
            tool={tool}
            canEdit={canMark}
            pending={outline.length}
            onTool={(next) => changeTool(next, false)}
            onFinish={() => finishOutline()}
            onCancel={cancelOutline}
          />
        )}
        {shapeError && (
          <p className="annotation-error" role="alert">
            {shapeError}
          </p>
        )}
        <AnnotationList
          shapes={[...framePoints, ...draft.shapes]}
          selected={mode === "edit" && selectedAnnotation ? selected : null}
          hidden={hiddenShapes}
          canEdit={canMark}
          onSelect={selectShape}
          onDelete={deleteShape}
          onToggle={toggleShape}
        />
        <div className="annotation-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!undo.length || !canMark}
            onClick={undoChange}
          >
            <RotateCcw /> 撤销
          </Button>
          {current && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canMark}
              onClick={() => {
                setUndo([
                  ...undo,
                  { kind: "frame", key: timeMs, frame: current },
                ])
                updateFrame(timeMs)
                if (selectedAnnotation?.kind === "point") setSelected(null)
              }}
            >
              清除本帧的点
            </Button>
          )}
        </div>
        <div className="annotation-frames">
          <div className="annotation-section-title">
            <h3>已标注帧</h3>
            <span>{frames.length} 帧</span>
          </div>
          {!!frames.length && (
            <ul>
              {frames.map((item) => (
                <li key={item.timeMs}>
                  <button
                    type="button"
                    aria-current={item.timeMs === timeMs ? "true" : undefined}
                    onClick={() =>
                      seek(item.timeMs / 1000 + (fps ? 0.1 / fps : 0))
                    }
                  >
                    <span>
                      {item.frameIndex === null
                        ? `${(item.timeMs / 1000).toFixed(3)} s`
                        : `第 ${item.frameIndex + 1} 帧`}
                    </span>
                    <span>{Object.keys(item.points).length} 个点</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {source.kind === "local" && (
          <div className="annotation-fps">
            <label htmlFor="annotation-fps">帧率（FPS）</label>
            <input
              id="annotation-fps"
              type="number"
              min={1}
              max={240}
              step="any"
              placeholder="填写后可逐帧定位"
              value={fpsInput}
              disabled={!!frames.length}
              onChange={(event) => setFpsInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
              }}
              onBlur={() => {
                const value = Number(fpsInput)
                if (value >= 1 && value <= 240)
                  persist({ ...draft, fps: value })
                else if (!fpsInput) persist({ ...draft, fps: null })
                else setFpsInput(fps?.toString() ?? "")
              }}
            />
            <p>恒定帧率视频按所填帧率定位。</p>
          </div>
        )}
        <footer className="annotation-footer">
          <span role="status">
            {saveFailed || !storageKey
              ? "无法自动保存，请导出标注。"
              : "自动保存到当前浏览器"}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={!meta || (!frames.length && !draft.shapes.length)}
            onClick={exportDraft}
          >
            <Download /> 导出 JSON
          </Button>
        </footer>
      </aside>
    </div>
  )
}
