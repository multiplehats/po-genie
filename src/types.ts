export interface TranslateOptions {
  /** Path to the source .po, .pot, or readme .txt file */
  input: string
  /** Target locale(s), e.g. "nl_NL" or ["nl_NL", "de_DE"] */
  locale: string | string[]
  /**
   * Output path. With one locale, this is the exact output file; by default,
   * a locale-suffixed file is created beside the input. With multiple locales,
   * this is the directory for those locale-suffixed files.
   */
  output?: string
  /** OpenRouter model to use. Defaults to "anthropic/claude-3.5-haiku" */
  model?: string
  /** OpenRouter API key. Defaults to OPENROUTER_API_KEY env var */
  apiKey?: string
  /** Extra context about the project sent to the AI */
  context?: string
  /** Number of translation jobs per AI request. Defaults to 40 */
  batchSize?: number
  /** Only translate required empty msgstr slots; preserve completed slots. Defaults to true */
  onlyMissing?: boolean
  /** Called after each batch with progress info */
  onProgress?: (progress: Progress) => void
}

export interface Progress {
  locale: string
  /** Completed catalog entries for PO, or completed translatable segments for readme; includes resumed work. */
  translated: number
  /** Selected catalog entries for PO (not plural-form jobs), or translatable readme segments. */
  total: number
  batch: number
  batches: number
}

export interface TokenUsage {
  /**
   * Known usage from successful provider responses, including checkpointed
   * work. Failed-attempt usage is unavailable and therefore excluded.
   */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Estimated cost in USD, present when the model is in the known price list */
  estimatedCostUsd?: number
}

export interface TranslateResult {
  locale: string
  output: string
  /** Completed catalog entries for PO, or translatable segments for readme; includes resumed work. */
  translated: number
  /** PO catalog entries not selected; always zero for readme translation. */
  skipped: number
  usage: TokenUsage
}
