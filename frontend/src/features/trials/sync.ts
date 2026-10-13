import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Video ↔ frame synchronization for one trial's track.
 *
 * The source and overlay videos start at frame 0 of the processing segment
 * and the track's `time_s = frame / fps`, so the mapping is a plain linear
 * scale. `currentTime` is sampled with rAF while playing so overlays and the
 * speed cursor follow the video, plus `seeked`/`timeupdate` for paused seeks
 * (browsers throttle rAF on hidden tabs).
 */
export function useFrameSync(fps: number, frameCount: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [frame, setFrameState] = useState(0)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || fps <= 0) {
      return
    }
    const push = () => {
      const index = clampFrame(Math.round(video.currentTime * fps), frameCount)
      setFrameState((prev) => (prev === index ? prev : index))
    }
    const sample = (now: number) => {
      rafRef.current = requestAnimationFrame(sample)
      // ~10 Hz keeps overlays and the speed cursor in step with playback
      // without re-rendering the page on every single frame.
      if (now - lastTickRef.current < 100) {
        return
      }
      lastTickRef.current = now
      push()
    }
    const start = () => {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(sample)
      }
    }
    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    video.addEventListener("play", start)
    video.addEventListener("pause", stop)
    video.addEventListener("seeked", push)
    video.addEventListener("timeupdate", push)
    if (!video.paused) {
      start()
    }
    return () => {
      stop()
      video.removeEventListener("play", start)
      video.removeEventListener("pause", stop)
      video.removeEventListener("seeked", push)
      video.removeEventListener("timeupdate", push)
    }
  }, [fps, frameCount])

  const setFrame = useCallback(
    (next: number) => {
      const index = clampFrame(next, frameCount)
      setFrameState(index)
      const video = videoRef.current
      if (video && fps > 0) {
        video.currentTime = index / fps
      }
    },
    [fps, frameCount],
  )

  return { videoRef, frame, setFrame }
}

function clampFrame(value: number, frameCount: number): number {
  if (frameCount <= 0) {
    return 0
  }
  return Math.min(Math.max(value, 0), frameCount - 1)
}

/**
 * Split observed centers into contiguous runs — miss/coord gaps must never be
 * bridged by a line, on the trail and on the metric charts alike. Each
 * segment carries the index of its first frame so callers can truncate at
 * the playback cursor without re-segmenting on every tick.
 */
export function segmentTrail(
  frames: { status: string; center?: Array<number> | null }[],
): Array<{ startIndex: number; points: Array<Array<number>> }> {
  const segments: Array<{ startIndex: number; points: Array<Array<number>> }> =
    []
  let current: Array<Array<number>> = []
  let start = 0
  let prevIndex = -1
  for (let index = 0; index < frames.length; index++) {
    const center = frames[index].center
    const observed =
      center !== null && center !== undefined && center.length >= 2
    if (observed && index === prevIndex + 1) {
      current.push(center)
    } else if (observed) {
      if (current.length > 0) {
        segments.push({ startIndex: start, points: current })
      }
      current = [center]
      start = index
    } else if (current.length > 0) {
      segments.push({ startIndex: start, points: current })
      current = []
    }
    prevIndex = observed ? index : -1
  }
  if (current.length > 0) {
    segments.push({ startIndex: start, points: current })
  }
  return segments
}
