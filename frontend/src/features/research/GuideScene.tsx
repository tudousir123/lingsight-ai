import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

const CHARACTER_DELAY_MS = 70
const INITIAL_PAUSE_MS = 350
const CHARACTER_FADE_MS = 240

export function GuideScene({
  active,
  title,
  first = false,
  children,
}: {
  active: boolean
  title: string
  first?: boolean
  children: ReactNode
}) {
  const [visible, setVisible] = useState(0)
  const [finished, setFinished] = useState(false)
  const visited = useRef(false)
  const letters = Array.from(title)
  const Heading = first ? "h1" : "h2"

  useEffect(() => {
    if (!active) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(timer)
      setVisible(Array.from(title).length)
      setFinished(true)
    }
    if (visited.current || motion.matches) {
      finish()
    } else {
      const characters = Array.from(title)
      let count = 0
      const typeNext = () => {
        const character = characters[count]
        count += 1
        setVisible(count)
        if (count >= characters.length) {
          timer = setTimeout(() => setFinished(true), CHARACTER_FADE_MS)
          return
        }
        const pause =
          character === "\n"
            ? 500
            : /[.!?]/.test(character)
              ? 350
              : /[,;:]/.test(character)
                ? 250
                : 0
        timer = setTimeout(typeNext, CHARACTER_DELAY_MS + pause)
      }
      timer = setTimeout(typeNext, INITIAL_PAUSE_MS)
    }
    const onMotionChange = () => {
      if (motion.matches) finish()
    }
    motion.addEventListener("change", onMotionChange)
    return () => {
      clearTimeout(timer)
      motion.removeEventListener("change", onMotionChange)
    }
  }, [active, title])

  // Mark a scene visited only after it has actually left the screen; this also
  // avoids skipping the first animation during StrictMode's effect replay.
  useEffect(() => {
    if (!active && visible > 0) visited.current = true
  }, [active, visible])

  return (
    <div className={`research-scene-content ${finished ? "is-ready" : ""}`}>
      <Heading
        className="research-typewriter"
        tabIndex={-1}
        style={
          { "--research-glyph-fade": `${CHARACTER_FADE_MS}ms` } as CSSProperties
        }
      >
        <span className="sr-only">{title}</span>
        <span
          className="research-typewriter-ink"
          aria-hidden="true"
          data-typing={!finished}
        >
          {letters.map((character, index) => (
            <span
              key={`${index}-${character}`}
              className="research-typewriter-glyph"
              data-visible={index < visible}
              data-cursor={
                !finished && index === visible - 1 && character !== "\n"
              }
            >
              {character}
            </span>
          ))}
        </span>
      </Heading>
      <div className="research-scene-support" inert={!finished}>
        {children}
      </div>
    </div>
  )
}
