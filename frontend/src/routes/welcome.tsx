import { createFileRoute } from "@tanstack/react-router"
import { useLayoutEffect } from "react"
import LingSightLanding from "@/features/marketing/LingSightLanding"

function WelcomePage() {
  useLayoutEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined
    const anchor = document.getElementById(window.location.hash.slice(1))
    const resetHero = navigation?.type === "reload" && !window.location.hash
    if (!anchor && !resetHero) return
    // The initial fragment can arrive before the SPA has mounted its target.
    // main.tsx removes reload anchors; native history restoration must then
    // stay disabled until this page leaves, so it cannot restore that section.
    const restoration = window.history.scrollRestoration
    if (resetHero) window.history.scrollRestoration = "manual"
    const position = () => {
      if (anchor) anchor.scrollIntoView({ behavior: "instant" })
      else window.scrollTo({ top: 0, left: 0, behavior: "instant" })
    }
    position()
    const frame = requestAnimationFrame(position)
    return () => {
      cancelAnimationFrame(frame)
      if (resetHero) window.history.scrollRestoration = restoration
    }
  }, [])
  return <LingSightLanding />
}

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
  head: () => ({
    meta: [{ title: "LingSight Science · Animal Behavior Research" }],
  }),
})
