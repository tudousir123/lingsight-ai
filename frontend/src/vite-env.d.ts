/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_MOCK_VIDEO_WORKFLOW?: string
  readonly VITE_MOCK_VIDEO_OVERLAY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
