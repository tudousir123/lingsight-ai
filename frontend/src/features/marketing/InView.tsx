import { type ReactNode, useLayoutEffect, useRef, useState } from "react"

/** Arm once before paint; keep the observer on a stable, unanimated wrapper. */
export function InView({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState(false)
  const [inView, setInView] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (!element || preference.matches || !("IntersectionObserver" in window)) {
      return
    }

    setArmed(true)
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35,
          )
        ) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    observer.observe(element)

    // A preference change also releases any content still waiting off screen.
    const handlePreference = () => {
      if (preference.matches) {
        setArmed(false)
        observer.disconnect()
      }
    }
    preference.addEventListener("change", handlePreference)
    return () => {
      observer.disconnect()
      preference.removeEventListener("change", handlePreference)
    }
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      data-motion={armed ? "armed" : "static"}
      data-inview={inView ? "" : undefined}
    >
      {children}
    </div>
  )
}

/** Measure the real content so font loading and narrow layouts do not clip the end. */
export function ScrollPreview({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = viewport.current
    const body = content.current
    if (!frame || !body) return
    const measure = () => {
      frame.style.setProperty(
        "--scroll-end",
        `${Math.min(0, frame.clientHeight - body.scrollHeight)}px`,
      )
    }
    measure()
    if (!("ResizeObserver" in window)) return
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="workflow-scroll-viewport" ref={viewport}>
      <div className="workflow-scroll-content ilo-scroll" ref={content}>
        {children}
      </div>
    </div>
  )
}
