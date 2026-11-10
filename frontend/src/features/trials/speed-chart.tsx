import { memo, useMemo, useRef } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TrackBundle } from "@/client"

/**
 * Per-frame speed chart with the playback cursor.
 *
 * The line itself is static (the series never changes while playing), so it
 * is memoized behind a ref-bridged click handler: only the absolutely
 * positioned cursor div re-renders on the ~10 Hz frame-sync ticks.
 * `connectNulls` stays false so miss/coord gaps and window-edge frames
 * appear as honest gaps, matching the server-side speed definition
 * (±3-frame endpoint displacement, no interpolation).
 */
function SpeedLine({
  data,
  total,
  candidateTimeS,
  seekRef,
}: {
  data: { t: number; v: number | null }[]
  total: number
  candidateTimeS?: number | null
  seekRef: { current: ((timeS: number) => void) | undefined }
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
        onClick={(state) => {
          if (state && state.activeLabel !== undefined) {
            seekRef.current?.(Number(state.activeLabel))
          }
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, total]}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${v.toFixed(1)}s`}
        />
        <YAxis
          width={44}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${Math.round(v)}`}
          label={{
            value: "px/s",
            position: "insideTopLeft",
            fontSize: 11,
            dy: -4,
          }}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)} px/s`, "速度"]}
          labelFormatter={(label) => `t = ${Number(label).toFixed(3)} s`}
          contentStyle={{
            fontSize: 12,
            background: "var(--popover)",
            border: "1px solid var(--border)",
            color: "var(--popover-foreground)",
            borderRadius: 10,
          }}
        />
        {candidateTimeS !== undefined && candidateTimeS !== null && (
          <ReferenceLine
            x={candidateTimeS}
            stroke="#f59e0b"
            strokeDasharray="5 4"
            label={{
              value: "平台圈进入（候选）",
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--brand)",
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="v"
          stroke="var(--chart-1)"
          strokeWidth={1.6}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

const MemoSpeedLine = memo(SpeedLine)

export function SpeedChart({
  track,
  frame,
  onSeekTime,
  candidateTimeS,
  height = 180,
}: {
  track: TrackBundle
  frame: number
  onSeekTime?: (timeS: number) => void
  candidateTimeS?: number | null
  height?: number
}) {
  const seekRef = useRef(onSeekTime)
  seekRef.current = onSeekTime

  const frames = track.frames ?? []
  const speeds = track.speed ?? []
  const fps = track.fps ?? 30
  const data = useMemo(
    () =>
      frames.map((f, index) => ({
        t: f.time_s ?? index / fps,
        v: speeds[index] ?? null,
      })),
    [frames, speeds, fps],
  )
  const total = data.length > 0 ? data[data.length - 1].t : 1
  const current = frames[Math.min(frame, frames.length - 1)]
  const cursorT = current?.time_s ?? 0
  const cursorPct = total > 0 ? Math.min(100, (cursorT / total) * 100) : 0

  return (
    <div
      style={{ height }}
      role="img"
      aria-label="逐帧速度曲线（px/s）"
      className="relative"
    >
      <MemoSpeedLine
        data={data}
        total={total}
        candidateTimeS={candidateTimeS}
        seekRef={seekRef}
      />
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand"
        style={{ left: `${cursorPct}%` }}
        aria-hidden
      />
    </div>
  )
}
