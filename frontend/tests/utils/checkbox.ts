import type { Locator, Page } from "@playwright/test"
import { expect } from "@playwright/test"

/**
 * Toggle a shadcn/radix checkbox button by its aria-label.
 *
 * Use this instead of `locator.click()`: under parallel load the container
 * Chromium intermittently drops the synthesized activation click on the
 * checkbox button (and clicking the wrapping <label> is equally unreliable),
 * while `dispatchEvent("click")` reaches the React handler every time.
 *
 * For definition lists prefer `locator("dt").filter({ hasText })` over
 * `getByRole("term")` — role-based name lookup for <dt> intermittently
 * fails to resolve in the container even though the element is in the
 * accessibility snapshot.
 */
export async function setCheckbox(
  page: Page,
  ariaLabel: string,
  checked: boolean,
) {
  const box = page.locator(`button[role="checkbox"][aria-label="${ariaLabel}"]`)
  await toggleIfNeeded(box, checked)
  await expect(box).toHaveAttribute("aria-checked", String(checked))
}

async function toggleIfNeeded(box: Locator, checked: boolean) {
  const current = await box.getAttribute("aria-checked")
  if (current !== String(checked)) {
    await box.dispatchEvent("click")
  }
}
