import { createFileRoute } from "@tanstack/react-router";
import { PreparationPage } from "@/features/mwm-demo/pages";

export const Route = createFileRoute("/_layout/prepare")({
  component: PreparationPage,
  head: () => ({ meta: [{ title: "分析准备 - LingSight AI" }] }),
});
