import { memo, useMemo } from "react"
import type { GeometryBundle, TrackBundle } from "@/client"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { segmentTrail } from "./sync"

export type SceneLayers = {
  pool: boolean
  markers: boolean
  platform: boolean
  tracking: boolean
}

const markerLabels: Record<string, string> = {
  pentacle: "五角星",
  rectangle: "矩形",
  triangle: "三角",
  round: "圆形",
}

function markerLabel(label: string): string {
  return markerLabels[label] ?? label
}

/**
 * SVG overlay drawn on top of the trial video, in track pixel coordinates.
 *
 * Geometry provenance is fixed server-side: the pool circle comes from
 * per-video measurements, markers from the human LabelMe scene annotation,
 * and the platform circle from the experiment metadata consensus (E1) —
 * never from pixels. Missing layers simply don't render; the side panel
 * explains why. The static geometry is memoized so the ~10 Hz playback
 * cursor only re-renders the trail and the current position.
 */
export function SceneOverlay({
  geometry,
  track,
  frame,
  layers,
  showTrail,
}: {
  geometry: GeometryBundle
  track: TrackBundle
  frame: number
  layers: SceneLayers
  showTrail: boolean
}) {
  const width = track.width ?? 1920
  const height = track.height ?? 1080
  const frames = track.frames ?? []
  const current = frames[Math.min(frame, frames.length - 1)]
  const sw = Math.max(width * 0.0035, 3)
  const font = Math.max(width * 0.016, 18)
  const allSegments = useMemo(
    () => (showTrail ? segmentTrail(frames) : []),
    [frames, showTrail],
  )

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      role="img"
      aria-label="水池边界、标志物、基准平台与追踪位置叠加"
    >
      <defs>
        <linearGradient id="trial-trail" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      <SceneGeometry geometry={geometry} layers={layers} sw={sw} font={font} />

      {layers.tracking &&
        allSegments.map((segment, index) => {
          // points[k] is frame startIndex + k; truncate at the cursor.
          const limit = frame - segment.startIndex + 1
          const visible = limit > 0 ? segment.points.slice(0, limit) : []
          if (visible.length === 0) {
            return null
          }
          return (
            <polyline
              key={index}
              points={visible.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="url(#trial-trail)"
              strokeWidth={sw * 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}

      {layers.tracking && current?.center && (
        <g>
          {current.head && current.tail && (
            <line
              x1={current.tail[0]}
              y1={current.tail[1]}
              x2={current.head[0]}
              y2={current.head[1]}
              stroke="#f8fafc"
              strokeWidth={sw}
              strokeLinecap="round"
              opacity={0.85}
            />
          )}
          <circle
            cx={current.center[0]}
            cy={current.center[1]}
            r={sw * 3}
            fill="#f8fafc"
            stroke="#0f172a"
            strokeWidth={sw * 0.6}
          />
        </g>
      )}
    </svg>
  )
}

const SceneGeometry = memo(function SceneGeometry({
  geometry,
  layers,
  sw,
  font,
}: {
  geometry: GeometryBundle
  layers: SceneLayers
  sw: number
  font: number
}) {
  return (
    <>
      {layers.pool && geometry.pool.status === "available" && (
        <circle
          cx={geometry.pool.cx ?? 0}
          cy={geometry.pool.cy ?? 0}
          r={geometry.pool.r ?? 0}
          fill="rgba(34,211,238,0.05)"
          stroke="#22d3ee"
          strokeWidth={sw}
        />
      )}

      {layers.markers &&
        geometry.markers.status === "available" &&
        (geometry.markers.shapes ?? []).map((shape) => {
          const points = (shape.points ?? []).map((p) => p.join(",")).join(" ")
          return (
            <g key={shape.label}>
              <polygon
                points={points}
                fill="rgba(236,72,153,0.10)"
                stroke="#ec4899"
                strokeWidth={sw}
              />
              <text
                x={(shape.points?.[0]?.[0] ?? 0) + font * 0.4}
                y={(shape.points?.[0]?.[1] ?? 0) - font * 0.4}
                fontSize={font}
                fill="#f9a8d4"
              >
                {markerLabel(shape.label)}
              </text>
            </g>
          )
        })}

      {layers.platform && geometry.platform.status === "available" && (
        <g>
          <circle
            cx={geometry.platform.cx ?? 0}
            cy={geometry.platform.cy ?? 0}
            r={geometry.platform.r ?? 0}
            fill="rgba(250,204,21,0.12)"
            stroke="#facc15"
            strokeWidth={sw}
            strokeDasharray={`${sw * 4} ${sw * 2.5}`}
          />
          <text
            x={
              (geometry.platform.cx ?? 0) +
              (geometry.platform.r ?? 0) +
              font * 0.5
            }
            y={(geometry.platform.cy ?? 0) + font * 0.4}
            fontSize={font}
            fill="#fde047"
          >
            基准平台（元数据）
          </text>
        </g>
      )}
    </>
  )
})

const layerOptions: { key: keyof SceneLayers; label: string }[] = [
  { key: "pool", label: "水池边界" },
  { key: "markers", label: "朝向标志物" },
  { key: "platform", label: "基准平台" },
  { key: "tracking", label: "追踪位置" },
]

export function LayerToggles({
  layers,
  onChange,
}: {
  layers: SceneLayers
  onChange: (next: SceneLayers) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {layerOptions.map((option) => (
        <Label
          key={option.key}
          className="flex items-center gap-2 text-sm font-normal text-foreground/80"
        >
          <Checkbox
            checked={layers[option.key]}
            aria-label={`显示${option.label}`}
            onCheckedChange={(checked) =>
              onChange({ ...layers, [option.key]: checked === true })
            }
          />
          {option.label}
        </Label>
      ))}
    </div>
  )
}
