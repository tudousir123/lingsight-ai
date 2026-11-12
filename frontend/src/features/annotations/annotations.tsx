import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrialDirectoryPage } from "@/features/trials/directory"
import { ManualAnnotation } from "./ManualAnnotation"

export function AnnotationsPage() {
  const [tab, setTab] = useState("manual")
  return (
    <div className="annotation-page">
      <h1>视频与标注</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="视频工作区">
          <TabsTrigger value="manual">手动标注</TabsTrigger>
          <TabsTrigger value="directory">试次目录</TabsTrigger>
        </TabsList>
        <TabsContent
          value="manual"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <ManualAnnotation active={tab === "manual"} />
        </TabsContent>
        <TabsContent value="directory">
          <TrialDirectoryPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
