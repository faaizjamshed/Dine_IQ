/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FastAPI analytics backend. */
  readonly VITE_API_BASE_URL?: string
  /** "true" → serve src/mocks/*.json through the mock adapter. */
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
