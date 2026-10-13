import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/features/mwm-demo/pages";

export const Route = createFileRoute("/_layout/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "实验统计与报告 - LingSight AI" }] }),
});
