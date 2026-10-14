// 手写载荷类型：后端 research/query 的 OpenAPI 响应为 unknown
//（response_model=None），字段形状与 app/text_to_sql/pipeline.py 的
// ResearchQueryAnswer / ResearchQueryRejection 逐字段对应。

export type StageName = "generation" | "validation" | "execution"

export type StageEvent = {
  type: "stage"
  attempt: number
  stage: StageName
}

export type DataSourceInfo = {
  database: string
  tables: string[]
  queried_at: string
  row_limit: number
  truncated: boolean
}

export type AttemptTrace = {
  attempt: number
  stage: StageName
  reason_code: string
  message: string
}

export type QaAnswer = {
  status: "ok"
  question: string
  sql: string
  columns: string[]
  rows: (string | number | boolean | null)[][]
  row_count: number
  caliber_note: string
  data_source: DataSourceInfo
  attempts: number
  trace: AttemptTrace[]
  empty: boolean
  suggestion: string | null
}

export type QaRejection = {
  status: "rejected"
  reason_code: string
  message: string
  sql: string | null
  attempts: number
  trace: AttemptTrace[]
}

export type QaResult = QaAnswer | QaRejection

export type StreamEvent = StageEvent | ({ type: "result" } & QaResult)
