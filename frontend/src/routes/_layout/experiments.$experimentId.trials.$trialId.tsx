import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute(
  "/_layout/experiments/$experimentId/trials/$trialId",
)({
  component: Outlet,
})
