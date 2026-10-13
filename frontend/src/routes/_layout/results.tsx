import { createFileRoute } from "@tanstack/react-router";
import { ResultsPage } from "@/features/mwm-demo/pages";

export const Route = createFileRoute("/_layout/results")({
  component: ResultsPage,
  head: () => ({ meta: [{ title: "单次分析结果 - LingSight AI" }] }),
});
