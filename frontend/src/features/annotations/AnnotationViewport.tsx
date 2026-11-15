import { Hand, Maximize, Minus, Plus } from "lucide-react"
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import type { Point } from "./shapeGeometry"

const fit = { scale: 1, x: 0, y: 0 }

function clampView(
  scale: number,
  position: Point,
  width: number,
  height: number,
) {
  return {
    scale,
    x: Math.min(0, Math.max(-width * (scale - 1), position.x)),
    y: Math.min(0, Math.max(-height * (scale - 1), position.y)),
  }
}

export function AnnotationViewport({
  width,
  height,
  children,
}: {
  width?: number
  height?: number
  children: (panning: boolean, scale: number) => ReactNode
}) {
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointer: number
    start: Point
    position: Point
  } | null>(null)
  const [view, setView] = useState(fit)
  const [panMode, setPanMode] = useState(false)
  const [dragging, setDragging] = useState(false)
  const enabled = !!width && !!height

  const bounded = useCallback((scale: number, position: Point) => {
    const bounds = frame.current
    if (!bounds) return fit
    return clampView(scale, position, bounds.offsetWidth, bounds.offsetHeight)
  }, [])

  const zoom = useCallback((factor: number, pointer?: Point) => {
    // Read DOM geometry here so the updater below stays a pure function.
    const bounds = frame.current
    const box = bounds?.getBoundingClientRect()
    if (!bounds || !box) return
    const boundsWidth = bounds.offsetWidth
    const boundsHeight = bounds.offsetHeight
    const stageBox = stage.current?.getBoundingClientRect()
    const anchor =
      pointer ??
      (stage.current && stageBox
        ? {
            x: stageBox.left + stage.current.clientWidth / 2,
            y: stageBox.top + stage.current.clientHeight / 2,
          }
        : { x: box.left, y: box.top })
    setView((previous) => {
      const scale = Math.min(
        5,
        Math.max(1, Math.round(previous.scale * factor * 100) / 100),
      )
      const change = 1 - scale / previous.scale
      return clampView(
        scale,
        {
          x: previous.x + (anchor.x - box.left) * change,
          y: previous.y + (anchor.y - box.top) * change,
        },
        boundsWidth,
        boundsHeight,
      )
    })
  }, [])

  useEffect(() => {
    const area = stage.current
    if (!area || !enabled) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoom(event.deltaY < 0 ? 1.16 : 1 / 1.16, {
        x: event.clientX,
        y: event.clientY,
      })
    }
    area.addEventListener("wheel", wheel, { passive: false })
    return () => area.removeEventListener("wheel", wheel)
  }, [enabled, zoom])

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (
      view.scale === 1 ||
      !(event.button === 1 || (event.button === 0 && panMode))
    )
      return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      position: { x: view.x, y: view.y },
    }
    setDragging(true)
  }

  function finishPan(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return
    event.stopPropagation()
    drag.current = null
    setDragging(false)
  }

  return (
    <>
      {enabled && (
        <fieldset className="annotation-view-tools" aria-label="画布视图">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="平移画布"
            title="平移画布"
            aria-pressed={panMode}
            disabled={view.scale === 1}
            onClick={() => setPanMode(!panMode)}
          >
            <Hand />
          </Button>
          <span className="annotation-view-separator" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="缩小画布"
            title="缩小画布"
            disabled={view.scale === 1}
            onClick={() => zoom(1 / 1.35)}
          >
            <Minus />
          </Button>
          <output aria-label="画布缩放">{Math.round(view.scale * 100)}%</output>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="放大画布"
            title="放大画布"
            disabled={view.scale === 5}
            onClick={() => zoom(1.35)}
          >
            <Plus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="适应画面"
            title="适应画面"
            disabled={view.scale === 1}
            onClick={() => {
              setView(fit)
              setPanMode(false)
            }}
          >
            <Maximize />
          </Button>
        </fieldset>
      )}
      <div
        ref={stage}
        className="annotation-stage"
        data-pan={
          dragging
            ? "dragging"
            : panMode && view.scale > 1
              ? "ready"
              : undefined
        }
        onPointerDownCapture={startPan}
        onPointerMove={(event) => {
          const current = drag.current
          if (current?.pointer !== event.pointerId) return
          setView(
            bounded(view.scale, {
              x: current.position.x + event.clientX - current.start.x,
              y: current.position.y + event.clientY - current.start.y,
            }),
          )
        }}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onLostPointerCapture={finishPan}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault()
        }}
      >
        <div
          ref={frame}
          className="annotation-frame"
          style={
            enabled
              ? {
                  aspectRatio: width / height,
                  // Height follows the viewport so the transport bar below the
                  // canvas stays on the first screen (see manual-annotation.css).
                  width: `min(100%, calc(max(240px, 100dvh - var(--annotation-chrome)) * ${width / height}))`,
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                }
              : undefined
          }
        >
          {children(panMode && view.scale > 1, view.scale)}
        </div>
      </div>
    </>
  )
}
