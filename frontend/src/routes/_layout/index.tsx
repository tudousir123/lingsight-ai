import { createFileRoute } from "@tanstack/react-router";
import { ExperimentPage } from "@/features/mwm-demo/pages";

export const Route = createFileRoute("/_layout/")({
  component: ExperimentPage,
  head: () => ({ meta: [{ title: "实验与视频管理 - LingSight AI" }] }),
});
