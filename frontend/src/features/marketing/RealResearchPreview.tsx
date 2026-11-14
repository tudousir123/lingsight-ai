import { useEffect, useState } from "react"
import "./real-research-preview.css"

const videoUrl = "/local-preview/homepage-v3/mwm-crop-metrics-complete-89s.mp4"

export function RealResearchPreview() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(videoUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (
          response.ok &&
          response.headers.get("content-type")?.startsWith("video/")
        ) {
          setAvailable(true)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  if (!available) return null

  return (
    <div className="real-research">
      <div className="real-video-card">
        <div className="real-video-stage">
          <video
            src={videoUrl}
            autoPlay
            muted
            loop
            playsInline
            controls
            aria-label="Water maze experiment video with original annotations"
            onError={() => setAvailable(false)}
          />
        </div>
      </div>
    </div>
  )
}
