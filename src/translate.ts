import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  checkpointPathForOutput,
  createCheckpointIdentity,
  loadCheckpoint,
  removeCheckpoint,
  saveCheckpoint,
} from './checkpoint.js'
import {
  extractProtectedFragments,
  extractVariables,
  restoreProtectedFragments,
  restoreVariables,
  validateProtectedTokens,
} from './variables.js'
import { localeMetadataFor, localeToLanguageName, parsePO } from './po.js'
import type { POEntry } from './po.js'
import { parseReadme } from './readme.js'
import type { ReadmeSegment } from './readme.js'
import { retryTransientProviderCall } from './retry.js'
import type {
  LocaleTranslationFailure,
  TranslateOptions,
  TranslateResult,
  TokenUsage,
} from './types.js'

const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku'
const DEFAULT_BATCH_SIZE = 40
const DEFAULT_CONCURRENCY = 2

function validateBatchSize(batchSize: number): void {
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer')
  }
}

function validateConcurrency(concurrency: number): void {
  if (!Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error('concurrency must be a positive integer')
  }
}

class TranslationResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslationResponseError'
  }
}

function normalizeGeneratedTranslations(translations: string[]): string[] {
  return translations.filter((translation) => translation.trim().length > 0)
}

function providerStatusCode(error: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current = error

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const fields = current as Record<string, unknown>
    const status = fields.statusCode ?? fields.status
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
    current = fields.cause
  }

  return undefined
}

function safeFailureReason(error: unknown): string | undefined {
  if (error instanceof TranslationResponseError) return error.message

  const statusCode = providerStatusCode(error)
  return statusCode === undefined
    ? undefined
    : `Provider request failed (HTTP ${statusCode})`
}

/**
 * Thrown after all started locale translations settle when at least one fails.
 *
 * Provider request and response content is intentionally omitted so callers
 * can safely inspect partial outcomes. Failures may include a safe validation
 * summary or provider HTTP status.
 */
export class LocaleTranslationError extends Error {
  readonly successes: TranslateResult[]
  readonly failures: LocaleTranslationFailure[]
  readonly unstartedLocales: string[]

  constructor(
    successes: TranslateResult[],
    failures: LocaleTranslationFailure[],
    unstartedLocales: string[],
  ) {
    const failedLocales = failures.map(({ locale }) => locale).join(', ')
    super(`Translation failed for locale${failures.length === 1 ? '' : 's'}: ${failedLocales}`)
    this.name = 'LocaleTranslationError'
    this.successes = [...successes]
    this.failures = failures.map(({ locale, reason }) => ({
      locale,
      ...(reason === undefined ? {} : { reason }),
    }))
    this.unstartedLocales = [...unstartedLocales]
  }
}

/**
 * Cost per million tokens (input / output) in USD for common OpenRouter models.
 * https://openrouter.ai/models — update as prices change.
 */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'anthropic/claude-3.5-haiku':           { input: 0.80,  output: 4.00  },
  'anthropic/claude-3.5-haiku-20241022':  { input: 0.80,  output: 4.00  },
  'anthropic/claude-3.5-sonnet':          { input: 3.00,  output: 15.00 },
  'anthropic/claude-3-opus':              { input: 15.00, output: 75.00 },
  'google/gemini-2.0-flash-001':          { input: 0.10,  output: 0.40  },
  'google/gemini-flash-1.5':             { input: 0.075, output: 0.30  },
  'openai/gpt-4o':                        { input: 2.50,  output: 10.00 },
  'openai/gpt-4o-mini':                   { input: 0.15,  output: 0.60  },
  'meta-llama/llama-3.3-70b-instruct':    { input: 0.12,  output: 0.30  },
}

function estimateCost(modelId: string, promptTokens: number, completionTokens: number): number | undefined {
  const prices = MODEL_PRICES[modelId]
  if (!prices) return undefined
  return (promptTokens / 1_000_000) * prices.input + (completionTokens / 1_000_000) * prices.output
}

const translationsSchema = z.object({
  translations: z
    .array(z.string())
    .describe('Translated strings in the same order as the input array'),
})

interface TranslationRequestItem {
  template: string
  singularSource?: string
  pluralSource?: string
  formIndex?: number
  formCount?: number
  pluralForms?: string
  msgctxt?: string
}

interface TranslationJob {
  id: string
  entry: POEntry
  formIndex: number
  extracted: {
    vars: string[]
    immutable: ReturnType<typeof extractProtectedFragments>
  }
  requestItem: TranslationRequestItem
}

interface ReadmeTranslationJob {
  id: string
  index: number
  segment: ReadmeSegment & { type: 'translatable' }
  extracted: {
    template: string
    vars: string[]
    immutable: ReturnType<typeof extractProtectedFragments>
  }
  requestItem: {
    text: string
    context?: string
  }
}

function poJobId(entry: POEntry, formIndex: number): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      entry.msgctxt ?? null,
      entry.msgid,
      entry.msgid_plural ?? null,
      formIndex,
    ]))
    .digest('hex')
  return `po:${digest}`
}

function knownUsage(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): TokenUsage {
  const estimatedCostUsd = estimateCost(modelId, promptTokens, completionTokens)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
  }
}

function normalizePluralEntries(entries: POEntry[], pluralFormCount: number): void {
  for (const entry of entries) {
    if (!entry.msgid_plural) continue
    entry.msgstrs.length = pluralFormCount
    for (let formIndex = 0; formIndex < pluralFormCount; formIndex++) {
      entry.msgstrs[formIndex] ??= ''
    }
  }
}

function buildSystemPrompt(targetLanguage: string, context?: string): string {
  const contextLine = context ? `\nProject context: ${context}` : ''

  return `You are a professional software localisation translator.
Translate UI strings from English to ${targetLanguage}.${contextLine}

Rules:
- Preserve protected tokens like [VAR_0], [VAR1_0], [IMM_0], [IMM1_0], etc. exactly as-is
- Preserve printf specifiers (%s, %d) if any remain untokenised
- Keep HTML tags unchanged
- Match the tone: concise for labels/buttons, natural for descriptions
- The optional msgctxt field is metadata for disambiguation; never include it in a translation
- Plural items include raw singularSource and pluralSource strings plus formIndex, formCount, and pluralForms as non-translatable metadata
- Treat pluralForms as the authoritative mapping for the target form index
- Translate only the template field; preserve its [VAR_n] tokens and use raw source placeholders only to understand their identity
- Do not add or remove punctuation unless required by the target language
- Return ONLY the translated strings array — no explanations`
}

async function translateBatch(
  items: TranslationRequestItem[],
  targetLanguage: string,
  model: ReturnType<ReturnType<typeof createOpenRouter>['chat']>,
  context?: string,
): Promise<{ translations: string[]; promptTokens: number; completionTokens: number }> {
  const { object, usage } = await retryTransientProviderCall(() =>
    generateObject({
      model,
      maxRetries: 0,
      maxTokens: 4096,
      schema: translationsSchema,
      messages: [
        { role: 'system', content: buildSystemPrompt(targetLanguage, context) },
        { role: 'user', content: JSON.stringify(items) },
      ],
    }),
  )

  return {
    translations: normalizeGeneratedTranslations(object.translations),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  }
}

function resolveOutputPath(input: string, locale: string, output?: string): string {
  if (output) return resolve(output)

  const dir = dirname(resolve(input))
  const ext = extname(input)
  const name = basename(input, ext)

  // readme.txt → readme-nl_NL.txt
  if (ext === '.txt') {
    return join(dir, `${name}-${locale}.txt`)
  }

  // If the input is already a .po file containing the locale, write back in place
  if (ext === '.po' && name.endsWith(`-${locale}`)) {
    return resolve(input)
  }

  // Otherwise append the locale suffix (e.g. "leat-crm.pot" → "leat-crm-nl_NL.po")
  return join(dir, `${name}-${locale}.po`)
}

function planOutputPath(input: string, locale: string, output: string | undefined, multipleLocales: boolean): string {
  if (!multipleLocales || !output) return resolveOutputPath(input, locale, output)

  return join(resolve(output), basename(resolveOutputPath(input, locale)))
}

function normalizeLocales(locale: TranslateOptions['locale']): string[] {
  const values = Array.isArray(locale) ? locale : [locale]
  if (values.length === 0) throw new Error('At least one locale is required')

  const seen = new Map<string, string>()
  const locales: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) throw new Error('Locale must not be empty')
    if (!/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(trimmed)) {
      throw new Error(`Invalid locale: ${value}`)
    }

    const collisionKey = trimmed.replaceAll('-', '_').toLowerCase()
    const duplicate = seen.get(collisionKey)
    if (duplicate) throw new Error(`Duplicate locale: ${duplicate}`)
    seen.set(collisionKey, trimmed)
    locales.push(trimmed)
  }

  return locales
}

function validateMultiLocaleOutput(output: string | undefined): void {
  if (!output) return
  if (!existsSync(output)) throw new Error(`Multi-locale output directory must exist: ${output}`)
  if (!statSync(output).isDirectory()) throw new Error(`Multi-locale output must be a directory: ${output}`)
}

function planTranslationJobs(options: TranslateOptions): Array<TranslateOptions & { locale: string; output: string }> {
  const locales = normalizeLocales(options.locale)
  const multipleLocales = locales.length > 1
  if (multipleLocales) validateMultiLocaleOutput(options.output)
  const jobs = locales.map((locale) => ({
    ...options,
    locale,
    output: planOutputPath(options.input, locale, options.output, multipleLocales),
  }))
  const outputPaths = new Set(jobs.map((job) => job.output.toLowerCase()))

  if (outputPaths.size !== jobs.length) {
    throw new Error('Multiple locales resolve to the same output path')
  }

  return jobs
}

function buildReadmeSystemPrompt(targetLanguage: string): string {
  return `You are translating a WordPress plugin readme file into ${targetLanguage}.

Rules:
- Translate the text naturally and accurately
- Each input item has translatable "text" and optional non-translatable "context" metadata
- Translate only the "text" field; use "context" solely to choose appropriate wording
- Preserve all markdown formatting (bold, italic, links, lists)
- Keep URLs unchanged — do not translate URLs
- Keep code references unchanged (e.g. file paths, function names, CSS classes)
- Keep [VAR_0], [VAR1_0], [IMM_0], [IMM1_0] etc. protected tokens exactly as-is
- Return a JSON object with a "translations" array containing the translated strings in the same order`
}

async function translateReadmeFile(
  options: TranslateOptions & { locale: string },
  sourceBytes: Buffer,
): Promise<TranslateResult> {
  const {
    input,
    locale,
    output,
    model: modelId = DEFAULT_MODEL,
    apiKey,
    context,
    batchSize = DEFAULT_BATCH_SIZE,
    onlyMissing = true,
    onProgress,
  } = options

  const outputPath = resolveOutputPath(input, locale, output)
  const readme = parseReadme(sourceBytes)
  const translatableSegments = readme.segments.filter(
    (s): s is ReadmeSegment & { type: 'translatable' } => s.type === 'translatable',
  )
  const total = translatableSegments.length
  const jobs: ReadmeTranslationJob[] = translatableSegments.map((segment, index) => {
    const variables = extractVariables(segment.content)
    const immutable = extractProtectedFragments(variables.template)
    const extracted = { template: immutable.template, vars: variables.vars, immutable }
    return {
      id: `readme:${index}`,
      index,
      segment,
      extracted,
      requestItem: segment.context
        ? { text: extracted.template, context: segment.context }
        : { text: extracted.template },
    }
  })

  const checkpointIdentity = createCheckpointIdentity({
    source: sourceBytes,
    targetLocale: locale,
    pipeline: 'readme',
    model: modelId,
    batchSize,
    onlyMissing,
    context,
  })
  const resumeState = loadCheckpoint(outputPath, checkpointIdentity)
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const completedItemIds = [...(resumeState?.completedItemIds ?? [])]
  const checkpointTranslations = { ...(resumeState?.translations ?? {}) }
  const completedIds = new Set(completedItemIds)

  const restoredResume: Array<{ job: ReadmeTranslationJob; translation: string }> = []
  for (let completedIndex = 0; completedIndex < completedItemIds.length; completedIndex++) {
    const id = completedItemIds[completedIndex]
    const job = jobsById.get(id)
    if (!job) {
      const checkpointPath = checkpointPathForOutput(outputPath)
      throw new Error(
        `Checkpoint at ${checkpointPath} contains completed item ID ${id} `
        + `that does not match the selected readme jobs. Remove ${checkpointPath} to restart this translation.`,
      )
    }
    const protectedTranslation = checkpointTranslations[id]
    try {
      validateProtectedTokens(
        job.extracted.template,
        protectedTranslation,
        { locale, batch: 0, item: completedIndex + 1 },
      )
    } catch (error) {
      const checkpointPath = checkpointPathForOutput(outputPath)
      throw new Error(
        `Checkpoint at ${checkpointPath} contains an invalid protected translation for ${id}. `
        + `Remove ${checkpointPath} to restart this translation.`,
        { cause: error },
      )
    }
    const immutableRestored = restoreProtectedFragments(
      protectedTranslation,
      job.extracted.immutable,
    )
    restoredResume.push({
      job,
      translation: restoreVariables(immutableRestored, job.extracted.vars),
    })
  }

  for (const { job, translation } of restoredResume) {
    job.segment.translated = translation
  }

  let translated = restoredResume.length
  let promptTokens = resumeState?.usage.promptTokens ?? 0
  let completionTokens = resumeState?.usage.completionTokens ?? 0
  const pendingJobs = jobs.filter((job) => !completedIds.has(job.id))

  if (pendingJobs.length === 0) {
    readme.save(outputPath)
    removeCheckpoint(outputPath)
    return {
      locale,
      output: outputPath,
      translated,
      skipped: 0,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    }
  }

  const resolvedKey = apiKey ?? process.env.OPENROUTER_API_KEY
  if (!resolvedKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY or pass apiKey option.',
    )
  }
  const openrouter = createOpenRouter({ apiKey: resolvedKey })
  const model = openrouter.chat(modelId)
  const targetLanguage = localeToLanguageName(locale)
  const systemPrompt = buildReadmeSystemPrompt(targetLanguage)
  const contextLine = context ? `\nProject context: ${context}` : ''

  const batches: ReadmeTranslationJob[][] = []
  for (let i = 0; i < pendingJobs.length; i += batchSize) {
    batches.push(pendingJobs.slice(i, i + batchSize))
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]
    const items = batch.map((job) => job.requestItem)

    const { object, usage } = await retryTransientProviderCall(() =>
      generateObject({
        model,
        maxRetries: 0,
        maxTokens: 4096,
        schema: translationsSchema,
        messages: [
          { role: 'system', content: systemPrompt + contextLine },
          { role: 'user', content: JSON.stringify(items) },
        ],
      }),
    )

    promptTokens += usage.promptTokens
    completionTokens += usage.completionTokens

    // Persist known paid usage before validating the response. The completed
    // work remains at the last accepted batch until all translations validate.
    saveCheckpoint(outputPath, checkpointIdentity, {
      completedItemIds,
      translations: checkpointTranslations,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    })

    const translations = normalizeGeneratedTranslations(object.translations)
    if (translations.length !== items.length) {
      throw new TranslationResponseError(
        `AI returned ${translations.length} translations for ${items.length} inputs`,
      )
    }

    for (let j = 0; j < batch.length; j++) {
      const job = batch[j]
      validateProtectedTokens(
        job.extracted.template,
        translations[j],
        { locale, batch: batchIndex + 1, item: job.index + 1 },
      )
    }

    const restoredBatch = batch.map((job, j) => {
      const immutableRestored = restoreProtectedFragments(
        translations[j],
        job.extracted.immutable,
      )
      return restoreVariables(immutableRestored, job.extracted.vars)
    })

    for (let j = 0; j < batch.length; j++) {
      batch[j].segment.translated = restoredBatch[j]
      translated++
      completedItemIds.push(batch[j].id)
      checkpointTranslations[batch[j].id] = translations[j]
    }

    saveCheckpoint(outputPath, checkpointIdentity, {
      completedItemIds,
      translations: checkpointTranslations,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    })

    onProgress?.({
      locale,
      translated,
      total,
      batch: batchIndex + 1,
      batches: batches.length,
    })
  }

  readme.save(outputPath)
  removeCheckpoint(outputPath)

  return {
    locale,
    output: outputPath,
    translated,
    skipped: 0,
    usage: knownUsage(modelId, promptTokens, completionTokens),
  }
}

async function translateFileFromSource(
  options: TranslateOptions & { locale: string },
  sourceBytes: Buffer,
): Promise<TranslateResult> {
  const ext = extname(options.input).toLowerCase()

  if (ext === '.txt') {
    return translateReadmeFile(options, sourceBytes)
  }

  const {
    input,
    locale,
    output,
    model: modelId = DEFAULT_MODEL,
    apiKey,
    context,
    batchSize = DEFAULT_BATCH_SIZE,
    onlyMissing = true,
    onProgress,
  } = options

  const outputPath = resolveOutputPath(input, locale, output)
  const po = parsePO(sourceBytes)
  const localeMetadata = localeMetadataFor(locale)
  const pluralFormCount = localeMetadata.pluralFormCount
  po.setLocale(locale)

  const translationJobs: TranslationJob[] = []
  const selectedEntries = new Set<POEntry>()

  for (const entry of po.entries) {
    const singularVariables = extractVariables(entry.msgid)
    const singularImmutable = extractProtectedFragments(singularVariables.template)
    const singularExtracted = {
      vars: singularVariables.vars,
      immutable: singularImmutable,
    }
    const pluralVariables = entry.msgid_plural
      ? extractVariables(entry.msgid_plural)
      : undefined
    const pluralImmutable = pluralVariables
      ? extractProtectedFragments(pluralVariables.template)
      : undefined
    const pluralExtracted = pluralVariables && pluralImmutable
      ? {
          vars: pluralVariables.vars,
          immutable: pluralImmutable,
        }
      : undefined
    const formCount = pluralExtracted ? pluralFormCount : 1

    for (let formIndex = 0; formIndex < formCount; formIndex++) {
      if (onlyMissing && entry.msgstrs[formIndex]) continue

      const extracted = formIndex === 0 ? singularExtracted : pluralExtracted!
      const requestItem: TranslationRequestItem = {
        template: extracted.immutable.template,
        ...(pluralExtracted
          ? {
              singularSource: entry.msgid,
              pluralSource: entry.msgid_plural!,
              formIndex,
              formCount,
              pluralForms: localeMetadata.pluralForms,
            }
          : {}),
        ...(entry.msgctxt ? { msgctxt: entry.msgctxt } : {}),
      }

      translationJobs.push({
        id: poJobId(entry, formIndex),
        entry,
        formIndex,
        extracted,
        requestItem,
      })
      selectedEntries.add(entry)
    }
  }

  const total = selectedEntries.size
  const skipped = po.entries.length - total
  const checkpointIdentity = createCheckpointIdentity({
    source: sourceBytes,
    targetLocale: locale,
    pipeline: 'po',
    model: modelId,
    batchSize,
    onlyMissing,
    context,
  })
  const resumeState = loadCheckpoint(outputPath, checkpointIdentity)
  const jobsById = new Map<string, TranslationJob>()
  for (const job of translationJobs) {
    if (jobsById.has(job.id)) {
      throw new Error(`PO translation jobs produced duplicate stable ID ${job.id}`)
    }
    jobsById.set(job.id, job)
  }

  const completedItemIds = [...(resumeState?.completedItemIds ?? [])]
  const checkpointTranslations = { ...(resumeState?.translations ?? {}) }
  const completedIds = new Set(completedItemIds)
  const remainingJobs = new Map<POEntry, number>()
  for (const job of translationJobs) {
    remainingJobs.set(job.entry, (remainingJobs.get(job.entry) ?? 0) + 1)
  }

  const restoredResume: Array<{ job: TranslationJob; translation: string }> = []
  for (let completedIndex = 0; completedIndex < completedItemIds.length; completedIndex++) {
    const id = completedItemIds[completedIndex]
    const job = jobsById.get(id)
    if (!job) {
      const checkpointPath = checkpointPathForOutput(outputPath)
      throw new Error(
        `Checkpoint at ${checkpointPath} contains completed item ID ${id} `
        + `that does not match the selected PO jobs. Remove ${checkpointPath} to restart this translation.`,
      )
    }
    const protectedTranslation = checkpointTranslations[id]
    try {
      validateProtectedTokens(
        job.requestItem.template,
        protectedTranslation,
        { locale, batch: 0, item: completedIndex + 1 },
      )
    } catch (error) {
      const checkpointPath = checkpointPathForOutput(outputPath)
      throw new Error(
        `Checkpoint at ${checkpointPath} contains an invalid protected translation for ${id}. `
        + `Remove ${checkpointPath} to restart this translation.`,
        { cause: error },
      )
    }
    const immutableRestored = restoreProtectedFragments(
      protectedTranslation,
      job.extracted.immutable,
    )
    restoredResume.push({
      job,
      translation: restoreVariables(immutableRestored, job.extracted.vars),
    })
  }

  let translated = 0
  for (const { job, translation } of restoredResume) {
    job.entry.msgstrs[job.formIndex] = translation
    const remaining = (remainingJobs.get(job.entry) ?? 1) - 1
    remainingJobs.set(job.entry, remaining)
    if (remaining === 0) translated++
  }

  let promptTokens = resumeState?.usage.promptTokens ?? 0
  let completionTokens = resumeState?.usage.completionTokens ?? 0
  const pendingIndices = translationJobs
    .map((job, index) => completedIds.has(job.id) ? undefined : index)
    .filter((index): index is number => index !== undefined)

  if (pendingIndices.length === 0) {
    normalizePluralEntries(po.entries, pluralFormCount)
    po.save(outputPath)
    removeCheckpoint(outputPath)
    return {
      locale,
      output: outputPath,
      translated,
      skipped,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    }
  }

  const resolvedKey = apiKey ?? process.env.OPENROUTER_API_KEY
  if (!resolvedKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY or pass apiKey option.',
    )
  }
  const openrouter = createOpenRouter({ apiKey: resolvedKey })
  const model = openrouter.chat(modelId)
  const targetLanguage = localeToLanguageName(locale)

  // Split only unfinished translation jobs into new batches.
  const batches: number[][] = []
  for (let i = 0; i < pendingIndices.length; i += batchSize) {
    batches.push(pendingIndices.slice(i, i + batchSize))
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const indices = batches[batchIndex]
    const items = indices.map((i) => translationJobs[i].requestItem)

    const result = await translateBatch(items, targetLanguage, model, context)

    promptTokens += result.promptTokens
    completionTokens += result.completionTokens

    // Persist known paid usage before validating the response. The completed
    // work remains at the last accepted batch until all translations validate.
    saveCheckpoint(outputPath, checkpointIdentity, {
      completedItemIds,
      translations: checkpointTranslations,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    })

    if (result.translations.length !== items.length) {
      throw new TranslationResponseError(
        `AI returned ${result.translations.length} translations for ${items.length} inputs`,
      )
    }

    for (let j = 0; j < indices.length; j++) {
      const job = translationJobs[indices[j]]
      validateProtectedTokens(
        job.requestItem.template,
        result.translations[j],
        { locale, batch: batchIndex + 1, item: indices[j] + 1 },
      )
    }

    const restoredBatch = indices.map((jobIndex, j) => {
      const job = translationJobs[jobIndex]
      const immutableRestored = restoreProtectedFragments(
        result.translations[j],
        job.extracted.immutable,
      )
      return restoreVariables(immutableRestored, job.extracted.vars)
    })

    for (let j = 0; j < indices.length; j++) {
      const job = translationJobs[indices[j]]
      job.entry.msgstrs[job.formIndex] = restoredBatch[j]
      const remaining = (remainingJobs.get(job.entry) ?? 1) - 1
      remainingJobs.set(job.entry, remaining)
      if (remaining === 0) translated++
    }

    for (let j = 0; j < indices.length; j++) {
      const job = translationJobs[indices[j]]
      completedItemIds.push(job.id)
      checkpointTranslations[job.id] = result.translations[j]
    }
    saveCheckpoint(outputPath, checkpointIdentity, {
      completedItemIds,
      translations: checkpointTranslations,
      usage: knownUsage(modelId, promptTokens, completionTokens),
    })

    onProgress?.({
      locale,
      translated,
      total,
      batch: batchIndex + 1,
      batches: batches.length,
    })
  }

  normalizePluralEntries(po.entries, pluralFormCount)
  po.save(outputPath)
  removeCheckpoint(outputPath)

  return {
    locale,
    output: outputPath,
    translated,
    skipped,
    usage: knownUsage(modelId, promptTokens, completionTokens),
  }
}

export async function translateFile(
  options: TranslateOptions & { locale: string },
): Promise<TranslateResult> {
  validateConcurrency(options.concurrency === undefined
    ? DEFAULT_CONCURRENCY
    : options.concurrency)
  validateBatchSize(options.batchSize === undefined ? DEFAULT_BATCH_SIZE : options.batchSize)

  return translateFileFromSource(options, readFileSync(options.input))
}

export async function translate(options: TranslateOptions): Promise<TranslateResult[]> {
  const concurrency = options.concurrency === undefined
    ? DEFAULT_CONCURRENCY
    : options.concurrency
  validateConcurrency(concurrency)
  validateBatchSize(options.batchSize === undefined ? DEFAULT_BATCH_SIZE : options.batchSize)

  const jobs = planTranslationJobs(options)
  const sourceBytes = readFileSync(options.input)
  const results: Array<TranslateResult | undefined> = new Array(jobs.length)
  const failures: Array<LocaleTranslationFailure | undefined> = new Array(jobs.length)
  let nextIndex = 0
  let failureKnown = false

  async function worker(): Promise<void> {
    while (!failureKnown) {
      const index = nextIndex
      if (index >= jobs.length) return
      nextIndex++

      try {
        results[index] = await translateFileFromSource(jobs[index], Buffer.from(sourceBytes))
      } catch (error) {
        const reason = safeFailureReason(error)
        failures[index] = {
          locale: jobs[index].locale,
          ...(reason === undefined ? {} : { reason }),
        }
        failureKnown = true
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, jobs.length) },
    () => worker(),
  )
  await Promise.all(workers)

  const localeFailures = failures.filter(
    (failure): failure is LocaleTranslationFailure => failure !== undefined,
  )
  if (localeFailures.length > 0) {
    const successes = results.filter(
      (result): result is TranslateResult => result !== undefined,
    )
    const unstartedLocales = jobs.slice(nextIndex).map(({ locale }) => locale)
    throw new LocaleTranslationError(successes, localeFailures, unstartedLocales)
  }

  return results as TranslateResult[]
}
