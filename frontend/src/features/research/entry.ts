import { briefPrompt, readBrief } from "./brief"

let seen = false
const KEY = "lingsight.onboarding-seen.v1"
export function onboardingSeen() {
  try {
    return seen || localStorage.getItem(KEY) === "1" || !!readBrief()
  } catch {
    return seen || !!readBrief()
  }
}
export function markOnboardingSeen() {
  seen = true
  try {
    localStorage.setItem(KEY, "1")
  } catch {
    /* A saved brief also permits entering the workspace. */
  }
}

export function pendingBriefPrompt() {
  const brief = readBrief()
  if (!brief) return ""
  try {
    return sessionStorage.getItem("lingsight.consumed-brief") ===
      JSON.stringify(brief)
      ? ""
      : briefPrompt(brief)
  } catch {
    return briefPrompt(brief)
  }
}
export function consumeBrief() {
  try {
    sessionStorage.setItem(
      "lingsight.consumed-brief",
      JSON.stringify(readBrief()),
    )
  } catch {
    /* Submission already succeeded. */
  }
}
