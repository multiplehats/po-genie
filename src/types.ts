export interface TranslateOptions {
  /** Path to the source .po or .pot file */
  input: string
  /** Target locale(s), e.g. "nl_NL" or ["nl_NL", "de_DE"] */
  locale: string | string[]
  /**
   * Output path. Defaults to input dir + `/<filename>-<locale>.po`.
   * When multiple locales are given, this is used as a directory.
   */
  output?: string
  /** OpenRouter model to use. Defaults to "anthropic/claude-3.5-haiku" */
  model?: string
  /** OpenRouter API key. Defaults to OPENROUTER_API_KEY env var */
  apiKey?: string
  /** Extra context about the project sent to the AI */
  context?: string
  /** Number of strings to translate per AI request. Defaults to 40 */
  batchSize?: number
  /** Only translate empty msgstr entries, skip already-translated. Defaults to true */
  onlyMissing?: boolean
  /** Called after each batch with progress info */
  onProgress?: (progress: Progress) => void
}

export interface Progress {
  locale: string
  translated: number
  total: number
  batch: number
  batches: number
}

export interface TranslateResult {
  locale: string
  output: string
  translated: number
  skipped: number
}
