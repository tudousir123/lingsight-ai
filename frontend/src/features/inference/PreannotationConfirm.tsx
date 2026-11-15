import { useQuery } from "@tanstack/react-query"
import { type PointerEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  type Confirmation,
  type ConfirmationInput,
  confirmationKey,
  fetchConfirmation,
  fetchPreannotation,
  mediaSrc,
  type Preannotation,
  useConfirmPreannotation,
} from "@/features/agent/videos"
import { AnnotationViewport } from "@/features/annotations/AnnotationViewport"
import { apiProblem, problemText } from "@/lib/apiError"
import { newUuid } from "@/lib/uuid"
import {
  clampPool,
  clientToImage,
  type Draft,
  draftFromCandidate,
  type Frame,
  nextMarkLabel,
  type Point,
  validateDraft,
} from "./preannotationGeometry"
import "@/features/annotations/manual-annotation.css"
import "./preannotation.css"

type Mode =
  | { type: "idle" }
  | { type: "place-seed" }
  | { type: "draw-pool"; center: Point | null }
  | { type: "draw-mark"; index: number }

type Drag =
  | { type: "seed" }
  | { type: "pool-center" }
  | { type: "pool-rim" }
  | { type: "vertex"; mark: number; vertex: number }

const dispatchText: Record<string, string> = {
  pending: "确认已保存，追踪尚未下发。",
  accepted: "上游已接受该确认；这只表示追踪任务已受理，并不代表追踪完成。",
  failed: "确认已保存，但下发追踪失败。",
}

// confirmationId is recorded once the server answers for this key.
type Attempt = { payload: string; key: string; confirmationId?: string }
// The browser keeps only the request in flight, so a reload can still replay it.
const attemptKey = (taskId: string) => `lingsight.confirm-attempt.${taskId}`
const isNumber = (value: unknown) => typeof value === "number"
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
// Session storage is outside our control; anything not shaped like a request
// we sent is treated as no attempt instead of throwing during render.
function parseInput(payload: string): ConfirmationInput | null {
  try {
    const value: unknown = JSON.parse(payload)
    if (!isRecord(value)) return null
    const { seed, pool, marks } = value
    const valid =
      typeof value.task_id === "string" &&
      typeof value.candidate_version === "string" &&
      (value.expected_confirmation_id === null ||
        typeof value.expected_confirmation_id === "string") &&
      isRecord(seed) &&
      [seed.frame, seed.x, seed.y].every(isNumber) &&
      isRecord(pool) &&
      [pool.cx, pool.cy, pool.radius].every(isNumber) &&
      Array.isArray(marks) &&
      marks.every(
        (mark) =>
          isRecord(mark) &&
          typeof mark.label === "string" &&
          Array.isArray(mark.polygon) &&
          mark.polygon.every(
            (point) =>
              Array.isArray(point) &&
              point.length === 2 &&
              point.every(isNumber),
          ),
      )
    return valid ? (value as ConfirmationInput) : null
  } catch {
    return null
  }
}
function readAttempt(taskId: string): Attempt | null {
  try {
    const raw = sessionStorage.getItem(attemptKey(taskId))
    const value: unknown = raw ? JSON.parse(raw) : null
    if (
      !isRecord(value) ||
      typeof value.payload !== "string" ||
      typeof value.key !== "string" ||
      !(
        value.confirmationId === undefined ||
        typeof value.confirmationId === "string"
      ) ||
      !parseInput(value.payload)
    )
      return null
    return {
      payload: value.payload,
      key: value.key,
      ...(value.confirmationId ? { confirmationId: value.confirmationId } : {}),
    }
  } catch {
    return null
  }
}
function writeAttempt(taskId: string, attempt: Attempt | null) {
  try {
    if (attempt)
      sessionStorage.setItem(attemptKey(taskId), JSON.stringify(attempt))
    else sessionStorage.removeItem(attemptKey(taskId))
  } catch {
    // Storage is best effort.
  }
}

const geometryOf = (
  value: Pick<ConfirmationInput, "seed" | "pool" | "marks">,
) =>
  JSON.stringify({
    seed: [value.seed.frame, value.seed.x, value.seed.y],
    pool: [value.pool.cx, value.pool.cy, value.pool.radius],
    marks: value.marks.map((mark) => [mark.label, mark.polygon]),
  })

// Only the exact request that produced this version may be replayed; anything
// else would be a new confirmation, not a redispatch of the saved one.
function replayable(attempt: Attempt | null, confirmed: Confirmation) {
  if (!attempt) return false
  if (attempt.confirmationId) return attempt.confirmationId === confirmed.id
  // Saved before the response arrived (e.g. a reload mid-request).
  const sent = parseInput(attempt.payload)
  return (
    !!sent &&
    sent.task_id === confirmed.task_id &&
    sent.candidate_version === confirmed.candidate_version &&
    geometryOf(sent) === geometryOf(confirmed)
  )
}

type ReviewTask = {
  id: string
  status: string
  project_id?: string
  video_id: string
  confirmation_id?: string | null
}

export function PreannotationConfirm({ task }: { task: ReviewTask }) {
  const projectId = task.project_id
  const candidate = useQuery({
    queryKey: ["preannotation", projectId, task.video_id, task.id],
    enabled: !!projectId,
    // The candidate version is immutable; task polling must not reset the draft.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: ({ signal }) =>
      fetchPreannotation(projectId as string, task.video_id, task.id, signal),
  })
  // The project/video latest is only the optimistic-lock base for a new
  // confirmation; it may belong to another task of the same video.
  const latest = useQuery({
    queryKey: confirmationKey(projectId ?? "", task.video_id, null),
    enabled: !!projectId,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await fetchConfirmation(
          projectId as string,
          task.video_id,
          null,
          signal,
        )
      } catch (error) {
        // Not yet confirmed is a 404 by contract, not a failure.
        if (apiProblem(error).status === 404) return null
        throw error
      }
    },
  })
  // This task's own immutable version, read by ID even when a later task
  // has replaced the latest.
  const own = useQuery({
    // Never share the latest key: its 404 means "none yet", here it is an error.
    queryKey: task.confirmation_id
      ? confirmationKey(projectId ?? "", task.video_id, task.confirmation_id)
      : ["preannotation-confirmation", "unconfirmed-task", task.id],
    enabled: !!projectId && !!task.confirmation_id,
    retry: false,
    queryFn: ({ signal }) =>
      fetchConfirmation(
        projectId as string,
        task.video_id,
        task.confirmation_id as string,
        signal,
      ),
  })
  if (!projectId)
    return <p role="alert">该推理任务没有项目归属，无法确认预标注。</p>
  if (
    candidate.isPending ||
    latest.isPending ||
    (!!task.confirmation_id && own.isPending)
  )
    return <p>正在读取候选预标注…</p>
  if (candidate.error)
    return (
      <p role="alert">
        {problemText(candidate.error, "无法读取候选预标注。")}
        <button
          type="button"
          className="project-action"
          onClick={() => void candidate.refetch()}
        >
          重试
        </button>
      </p>
    )
  const readError = latest.error ?? (task.confirmation_id ? own.error : null)
  // A failed read is not "unconfirmed": submitting would rest on a guess.
  if (readError)
    return (
      <p role="alert">
        无法读取已保存的确认版本：
        {problemText(readError, "请稍后重试。")}
        <button
          type="button"
          className="project-action"
          onClick={() => {
            if (latest.error) void latest.refetch()
            if (own.error) void own.refetch()
          }}
        >
          重试
        </button>
      </p>
    )
  const confirmed = task.confirmation_id
    ? own.data
    : // Just confirmed, before task polling reports the new ID.
      latest.data?.task_id === task.id
      ? latest.data
      : null
  return (
    <ConfirmEditor
      // A new candidate version replaces the browser draft; polling must not.
      key={candidate.data.candidate_version}
      task={task}
      projectId={projectId}
      candidate={candidate.data}
      confirmed={confirmed ?? null}
      latestId={latest.data?.id ?? null}
    />
  )
}

function ConfirmEditor({
  task,
  projectId,
  candidate,
  confirmed,
  latestId,
}: {
  task: ReviewTask
  projectId: string
  candidate: Preannotation
  confirmed: Confirmation | null
  latestId: string | null
}) {
  const frame: Frame = candidate
  const [draft, setDraft] = useState<Draft>(() =>
    confirmed
      ? {
          seed: confirmed.seed,
          pool: confirmed.pool,
          marks: confirmed.marks.map((mark) => ({
            label: mark.label,
            polygon: mark.polygon,
          })),
        }
      : draftFromCandidate(candidate, frame),
  )
  const [mode, setMode] = useState<Mode>({ type: "idle" })
  const [selected, setSelected] = useState<number | null>(null)
  const attempt = useRef<Attempt | null>(readAttempt(task.id))
  const confirm = useConfirmPreannotation(projectId, task.video_id)
  const errors = validateDraft(draft, frame)
  const locked = task.status !== "waiting_for_review"
  const dispatch = confirmed?.tracking_dispatch
  const canReplay = !!confirmed && replayable(attempt.current, confirmed)
  // The server refuses a new version while this task's saved one is still
  // being dispatched, whatever the draft says; only a replay may proceed.
  const dispatchPending = dispatch?.status === "pending"

  function post(next: Attempt) {
    attempt.current = next
    writeAttempt(task.id, next)
    confirm.mutate(
      {
        input: JSON.parse(next.payload) as ConfirmationInput,
        idempotencyKey: next.key,
      },
      {
        onSuccess: (saved) => {
          attempt.current = { ...next, confirmationId: saved.id }
          writeAttempt(task.id, attempt.current)
        },
        onError: (error) => {
          if (apiProblem(error).code === "idempotency_conflict") {
            attempt.current = null
            writeAttempt(task.id, null)
          }
        },
      },
    )
  }

  function submit() {
    const payload = JSON.stringify({
      task_id: task.id,
      candidate_version: candidate.candidate_version,
      // The server compares against the project/video latest, whichever task
      // produced it.
      expected_confirmation_id: latestId,
      seed: draft.seed,
      pool: draft.pool,
      marks: draft.marks,
    } satisfies ConfirmationInput)
    // Same payload keeps its key so a retry replays instead of duplicating.
    post(
      attempt.current?.payload === payload
        ? attempt.current
        : { payload, key: newUuid() },
    )
  }

  // Redispatching replays the saved request verbatim (same key and payload);
  // without it there is nothing to replay, and a new key would be a new
  // confirmation rather than this version's dispatch.
  function retryDispatch() {
    if (canReplay && attempt.current) post(attempt.current)
  }

  return (
    <div className="preannotation space-y-4">
      <p>
        对照候选帧（第 {candidate.frame_index} 帧，{candidate.width}×
        {candidate.height}
        ）拖动调整水池、小鼠起点和标志物，或删除后重画，然后确认。草稿只保存在浏览器，确认后才写入服务器。
      </p>
      {candidate.evidence.review_reasons.length > 0 && (
        <p className="text-amber-700">
          需核对：{candidate.evidence.review_reasons.join("；")}
        </p>
      )}
      <div className="preannotation-layout">
        <div className="preannotation-stage">
          <AnnotationViewport width={candidate.width} height={candidate.height}>
            {(panning, scale) => (
              <>
                <img
                  src={mediaSrc(candidate.image_url)}
                  alt="预标注参考帧"
                  draggable={false}
                />
                <Overlay
                  frame={frame}
                  draft={draft}
                  onChange={setDraft}
                  mode={mode}
                  onMode={setMode}
                  selected={selected}
                  onSelect={setSelected}
                  disabled={panning || locked}
                  scale={scale}
                />
              </>
            )}
          </AnnotationViewport>
        </div>
        <Controls
          frame={frame}
          draft={draft}
          onChange={setDraft}
          mode={mode}
          onMode={setMode}
          selected={selected}
          onSelect={setSelected}
          disabled={locked}
          onReset={() => {
            setDraft(draftFromCandidate(candidate, frame))
            setMode({ type: "idle" })
            setSelected(null)
          }}
        />
      </div>
      {errors.length > 0 && !locked && (
        <ul role="alert" className="preannotation-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {draft.marks.length === 0 && !locked && (
        <p className="text-sm text-muted-foreground">
          当前没有标志物；空列表可以提交，但不能用于需要标志物的科学结论。
        </p>
      )}
      {confirm.error && (
        <p role="alert" className="text-red-700">
          {problemText(confirm.error, "确认失败，请重试。")}
        </p>
      )}
      {!locked && (
        <Button
          type="button"
          disabled={confirm.isPending || errors.length > 0 || dispatchPending}
          onClick={submit}
        >
          {confirm.isPending
            ? "正在提交…"
            : dispatch?.status === "failed" && confirm.data === undefined
              ? "再次确认并开始追踪"
              : "确认并开始追踪"}
        </Button>
      )}
      {!locked && dispatchPending && (
        <p className="text-sm text-amber-700">
          已保存的确认版本仍在等待下发结果，服务器在此期间不接受新的确认版本；请等待任务状态更新。
        </p>
      )}
      {confirmed && (
        <div className="preannotation-confirmed" role="status">
          <p>
            已确认版本 <code>{confirmed.id}</code>
            ，确认于 {new Date(confirmed.confirmed_at).toLocaleString("zh-CN")}
            。
          </p>
          <p>
            {dispatchText[confirmed.tracking_dispatch.status]}
            {confirmed.tracking_dispatch.error_code &&
              `（${confirmed.tracking_dispatch.error_code}）`}
          </p>
          {confirmed.tracking_dispatch.status !== "accepted" &&
            !locked &&
            (canReplay ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                disabled={confirm.isPending}
                onClick={retryDispatch}
              >
                重试下发
              </Button>
            ) : (
              <p className="text-amber-700">
                本浏览器会话没有该版本的原始提交记录，无法在此重试下发；需在最初提交确认的浏览器会话中恢复下发。重新确认会创建新的版本，不会恢复这一版本。
              </p>
            ))}
          <p className="text-sm text-muted-foreground">
            预标注确认不等于发布：追踪完成后仍需人工复核结果（tracking_ok）再发布到项目。
          </p>
        </div>
      )}
    </div>
  )
}

function Overlay({
  frame,
  draft,
  onChange,
  mode,
  onMode,
  selected,
  onSelect,
  disabled,
  scale,
}: {
  frame: Frame
  draft: Draft
  onChange: (draft: Draft) => void
  mode: Mode
  onMode: (mode: Mode) => void
  selected: number | null
  onSelect: (index: number | null) => void
  disabled: boolean
  scale: number
}) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  // Handles keep a roughly constant on-screen size at any zoom.
  const unit = frame.width / 900 / scale
  const handle = 9 * unit

  const pointFrom = (event: PointerEvent) =>
    clientToImage(
      event.clientX,
      event.clientY,
      (svg.current as SVGSVGElement).getBoundingClientRect(),
      frame,
    )

  function begin(target: Drag, event: PointerEvent<SVGElement>) {
    if (disabled || mode.type !== "idle") return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = target
    if (target.type === "vertex") onSelect(target.mark)
  }

  function move(event: PointerEvent<SVGElement>) {
    const current = drag.current
    if (!current) return
    const [x, y] = pointFrom(event)
    if (current.type === "seed") {
      onChange({ ...draft, seed: { ...draft.seed, x, y } })
    } else if (current.type === "pool-center") {
      onChange({
        ...draft,
        pool: clampPool({ ...draft.pool, cx: x, cy: y }, frame),
      })
    } else if (current.type === "pool-rim") {
      const radius = Math.hypot(x - draft.pool.cx, y - draft.pool.cy)
      onChange({
        ...draft,
        pool: clampPool({ ...draft.pool, radius }, frame),
      })
    } else {
      onChange({
        ...draft,
        marks: draft.marks.map((mark, i) =>
          i === current.mark
            ? {
                ...mark,
                polygon: mark.polygon.map((point, j) =>
                  j === current.vertex ? ([x, y] as Point) : point,
                ),
              }
            : mark,
        ),
      })
    }
  }

  function end(event: PointerEvent<SVGElement>) {
    if (drag.current) event.stopPropagation()
    drag.current = null
  }

  function capture(event: PointerEvent<SVGRectElement>) {
    if (disabled) return
    const [x, y] = pointFrom(event)
    if (mode.type === "place-seed") {
      onChange({ ...draft, seed: { ...draft.seed, x, y } })
      onMode({ type: "idle" })
    } else if (mode.type === "draw-pool") {
      event.currentTarget.setPointerCapture(event.pointerId)
      onMode({ type: "draw-pool", center: [x, y] })
      onChange({
        ...draft,
        pool: clampPool({ cx: x, cy: y, radius: 1 }, frame),
      })
    } else if (mode.type === "draw-mark") {
      onChange({
        ...draft,
        marks: draft.marks.map((mark, i) =>
          i === mode.index
            ? { ...mark, polygon: [...mark.polygon, [x, y] as Point] }
            : mark,
        ),
      })
    }
  }

  function captureMove(event: PointerEvent<SVGRectElement>) {
    if (mode.type !== "draw-pool" || !mode.center) return
    const [x, y] = pointFrom(event)
    const radius = Math.hypot(x - mode.center[0], y - mode.center[1])
    onChange({
      ...draft,
      pool: clampPool(
        { cx: mode.center[0], cy: mode.center[1], radius },
        frame,
      ),
    })
  }

  const { pool, seed } = draft
  return (
    <svg
      ref={svg}
      role="img"
      aria-label="水池、小鼠起点和标志物候选"
      className="preannotation-overlay"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      data-mode={mode.type}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <circle
        cx={pool.cx}
        cy={pool.cy}
        r={Math.max(0, pool.radius)}
        className="preannotation-pool"
        strokeWidth={3 * unit}
      />
      {draft.marks.map((mark, i) => (
        <g key={i} data-selected={selected === i || undefined}>
          {mark.polygon.length >= 3 ? (
            <polygon
              points={mark.polygon.map((p) => p.join(",")).join(" ")}
              className="preannotation-mark"
              strokeWidth={3 * unit}
            />
          ) : (
            <polyline
              points={mark.polygon.map((p) => p.join(",")).join(" ")}
              className="preannotation-mark"
              fill="none"
              strokeWidth={3 * unit}
            />
          )}
          {mark.polygon.map((point, j) => (
            <circle
              key={j}
              data-testid={`vertex-${i}-${j}`}
              cx={point[0]}
              cy={point[1]}
              r={handle * 0.7}
              className="preannotation-handle preannotation-handle-mark"
              onPointerDown={(event) =>
                begin({ type: "vertex", mark: i, vertex: j }, event)
              }
            />
          ))}
        </g>
      ))}
      <circle
        data-testid="pool-center"
        cx={pool.cx}
        cy={pool.cy}
        r={handle}
        className="preannotation-handle preannotation-handle-pool"
        onPointerDown={(event) => begin({ type: "pool-center" }, event)}
      />
      <circle
        data-testid="pool-rim"
        cx={pool.cx + pool.radius}
        cy={pool.cy}
        r={handle}
        className="preannotation-handle preannotation-handle-pool"
        onPointerDown={(event) => begin({ type: "pool-rim" }, event)}
      />
      <circle
        data-testid="seed"
        cx={seed.x}
        cy={seed.y}
        r={handle * 1.1}
        className="preannotation-handle preannotation-seed"
        onPointerDown={(event) => begin({ type: "seed" }, event)}
      />
      {mode.type !== "idle" && (
        <rect
          data-testid="capture"
          width={frame.width}
          height={frame.height}
          className="preannotation-capture"
          onPointerDown={capture}
          onPointerMove={captureMove}
          onPointerUp={() => {
            if (mode.type === "draw-pool") onMode({ type: "idle" })
          }}
        />
      )}
    </svg>
  )
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step = "any",
}: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
  step?: string
}) {
  return (
    <label className="preannotation-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        disabled={disabled}
        value={Number.isNaN(value) ? "" : value}
        aria-invalid={!Number.isFinite(value)}
        onChange={(event) =>
          onChange(
            event.target.value.trim() === ""
              ? Number.NaN
              : Number(event.target.value),
          )
        }
      />
    </label>
  )
}

function Controls({
  frame,
  draft,
  onChange,
  mode,
  onMode,
  selected,
  onSelect,
  disabled,
  onReset,
}: {
  frame: Frame
  draft: Draft
  onChange: (draft: Draft) => void
  mode: Mode
  onMode: (mode: Mode) => void
  selected: number | null
  onSelect: (index: number | null) => void
  disabled: boolean
  onReset: () => void
}) {
  const { seed, pool } = draft
  const drawing = mode.type === "draw-mark" ? mode.index : null
  return (
    <div className="preannotation-controls">
      <fieldset disabled={disabled}>
        <legend>水池与小鼠起点</legend>
        <div className="preannotation-actions">
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            aria-pressed={mode.type === "draw-pool"}
            onClick={() =>
              onMode(
                mode.type === "draw-pool"
                  ? { type: "idle" }
                  : { type: "draw-pool", center: null },
              )
            }
          >
            重画水池
          </button>
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            aria-pressed={mode.type === "place-seed"}
            onClick={() =>
              onMode(
                mode.type === "place-seed"
                  ? { type: "idle" }
                  : { type: "place-seed" },
              )
            }
          >
            重新放置起点
          </button>
        </div>
        {mode.type === "draw-pool" && (
          <p className="text-sm">在画面上按住并拖出水池圆。</p>
        )}
        {mode.type === "place-seed" && (
          <p className="text-sm">在画面上点击小鼠起点。</p>
        )}
        <div className="preannotation-fields">
          <NumberField
            label="起始帧"
            step="1"
            value={seed.frame}
            disabled={disabled}
            onChange={(frameNo) =>
              onChange({ ...draft, seed: { ...seed, frame: frameNo } })
            }
          />
          <NumberField
            label="小鼠 X"
            value={seed.x}
            disabled={disabled}
            onChange={(x) => onChange({ ...draft, seed: { ...seed, x } })}
          />
          <NumberField
            label="小鼠 Y"
            value={seed.y}
            disabled={disabled}
            onChange={(y) => onChange({ ...draft, seed: { ...seed, y } })}
          />
          <NumberField
            label="水池中心 X"
            value={pool.cx}
            disabled={disabled}
            onChange={(cx) => onChange({ ...draft, pool: { ...pool, cx } })}
          />
          <NumberField
            label="水池中心 Y"
            value={pool.cy}
            disabled={disabled}
            onChange={(cy) => onChange({ ...draft, pool: { ...pool, cy } })}
          />
          <NumberField
            label="水池半径"
            value={pool.radius}
            disabled={disabled}
            onChange={(radius) =>
              onChange({ ...draft, pool: { ...pool, radius } })
            }
          />
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>标志物（{draft.marks.length}）</legend>
        <ul className="preannotation-marks">
          {draft.marks.map((mark, i) => (
            <li key={`${i}`} data-selected={selected === i || undefined}>
              <input
                aria-label={`标志物 ${i + 1} 名称`}
                value={mark.label}
                maxLength={100}
                onFocus={() => onSelect(i)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    marks: draft.marks.map((item, j) =>
                      j === i ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              <small>{mark.polygon.length} 点</small>
              {drawing === i ? (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1"
                  onClick={() => onMode({ type: "idle" })}
                >
                  完成轮廓
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1"
                  aria-label={`重画 ${mark.label}`}
                  onClick={() => {
                    onChange({
                      ...draft,
                      marks: draft.marks.map((item, j) =>
                        j === i ? { ...item, polygon: [] } : item,
                      ),
                    })
                    onSelect(i)
                    onMode({ type: "draw-mark", index: i })
                  }}
                >
                  重画
                </button>
              )}
              <button
                type="button"
                className="rounded-md border px-2 py-1"
                aria-label={`删除 ${mark.label}`}
                onClick={() => {
                  onChange({
                    ...draft,
                    marks: draft.marks.filter((_, j) => j !== i),
                  })
                  onSelect(null)
                  onMode({ type: "idle" })
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {drawing !== null && (
          <p className="text-sm">
            在画面上依次点击轮廓顶点，至少 3 个，然后点“完成轮廓”。
          </p>
        )}
        <button
          type="button"
          className="rounded-md border px-2 py-1"
          disabled={draft.marks.length >= 64}
          onClick={() => {
            const label = nextMarkLabel(draft.marks)
            onChange({
              ...draft,
              marks: [...draft.marks, { label, polygon: [] }],
            })
            onSelect(draft.marks.length)
            onMode({ type: "draw-mark", index: draft.marks.length })
          }}
        >
          新增标志物
        </button>
      </fieldset>
      <button
        type="button"
        className="rounded-md border px-2 py-1"
        disabled={disabled}
        onClick={onReset}
      >
        恢复候选
      </button>
      <p className="text-xs text-muted-foreground">
        画面 {frame.width}×{frame.height} 像素；坐标均为原视频像素。
      </p>
    </div>
  )
}
