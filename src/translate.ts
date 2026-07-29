import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateObject } from 'ai'
import { z } from 'zod'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  extractProtectedFragments,
  extractVariables,
  restoreProtectedFragments,
  restoreVariables,
  validateProtectedTokens,
} from './variables.js'
import { loadPO, localeMetadataFor, localeToLanguageName } from './po.js'
import type { POEntry } from './po.js'
import { loadReadme } from './readme.js'
import type { ReadmeSegment } from './readme.js'
import type { TranslateOptions, TranslateResult, TokenUsage } from './types.js'

const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku'
const DEFAULT_BATCH_SIZE = 40

function validateBatchSize(batchSize: number): void {
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer')
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
  entry: POEntry
  formIndex: number
  extracted: {
    vars: string[]
    immutable: ReturnType<typeof extractProtectedFragments>
  }
  requestItem: TranslationRequestItem
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
  const { object, usage } = await generateObject({
    model,
    maxTokens: 4096,
    schema: translationsSchema,
    messages: [
      { role: 'system', content: buildSystemPrompt(targetLanguage, context) },
      { role: 'user', content: JSON.stringify(items) },
    ],
  })

  if (object.translations.length !== items.length) {
    throw new Error(
      `AI returned ${object.translations.length} translations for ${items.length} inputs`,
    )
  }

  return {
    translations: object.translations,
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
): Promise<TranslateResult> {
  const {
    input,
    locale,
    output,
    model: modelId = DEFAULT_MODEL,
    apiKey,
    context,
    batchSize = DEFAULT_BATCH_SIZE,
    onProgress,
  } = options

  const resolvedKey = apiKey ?? process.env.OPENROUTER_API_KEY
  if (!resolvedKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY or pass apiKey option.',
    )
  }

  const openrouter = createOpenRouter({ apiKey: resolvedKey })
  const model = openrouter.chat(modelId)
  const targetLanguage = localeToLanguageName(locale)
  const outputPath = resolveOutputPath(input, locale, output)

  const readme = loadReadme(input)
  const translatableSegments = readme.segments.filter(
    (s): s is ReadmeSegment & { type: 'translatable' } => s.type === 'translatable',
  )

  const total = translatableSegments.length
  const emptyUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (total === 0) {
    readme.save(outputPath)
    return { locale, output: outputPath, translated: 0, skipped: 0, usage: emptyUsage }
  }

  // Extract variables and immutable fragments into protected templates.
  const extracted = translatableSegments.map((seg) => {
    const variables = extractVariables(seg.content)
    const immutable = extractProtectedFragments(variables.template)
    return { template: immutable.template, vars: variables.vars, immutable }
  })

  const itemsWithContext = translatableSegments.map((seg, i) => {
    const context = seg.context
    return context
      ? { text: extracted[i].template, context }
      : { text: extracted[i].template }
  })

  // Split into batches
  const batches: number[][] = []
  for (let i = 0; i < extracted.length; i += batchSize) {
    batches.push(
      Array.from({ length: Math.min(batchSize, extracted.length - i) }, (_, j) => i + j),
    )
  }

  let translated = 0
  let promptTokens = 0
  let completionTokens = 0

  const systemPrompt = buildReadmeSystemPrompt(targetLanguage)
  const contextLine = context ? `\nProject context: ${context}` : ''

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const indices = batches[batchIndex]
    const items = indices.map((i) => itemsWithContext[i])

    const { object, usage } = await generateObject({
      model,
      maxTokens: 4096,
      schema: translationsSchema,
      messages: [
        { role: 'system', content: systemPrompt + contextLine },
        { role: 'user', content: JSON.stringify(items) },
      ],
    })

    if (object.translations.length !== items.length) {
      throw new Error(
        `AI returned ${object.translations.length} translations for ${items.length} inputs`,
      )
    }

    promptTokens += usage.promptTokens
    completionTokens += usage.completionTokens

    for (let j = 0; j < indices.length; j++) {
      const entryIndex = indices[j]
      validateProtectedTokens(
        extracted[entryIndex].template,
        object.translations[j],
        { locale, batch: batchIndex + 1, item: entryIndex + 1 },
      )
    }

    const restoredBatch = indices.map((entryIndex, j) => {
      const immutableRestored = restoreProtectedFragments(
        object.translations[j],
        extracted[entryIndex].immutable,
      )
      return restoreVariables(immutableRestored, extracted[entryIndex].vars)
    })

    for (let j = 0; j < indices.length; j++) {
      const entryIndex = indices[j]
      translatableSegments[entryIndex].translated = restoredBatch[j]
      translated++
    }

    onProgress?.({
      locale,
      translated,
      total,
      batch: batchIndex + 1,
      batches: batches.length,
    })
  }

  readme.save(outputPath)

  const totalTokens = promptTokens + completionTokens
  const estimatedCostUsd = estimateCost(modelId, promptTokens, completionTokens)

  return {
    locale,
    output: outputPath,
    translated,
    skipped: 0,
    usage: { promptTokens, completionTokens, totalTokens, estimatedCostUsd },
  }
}

export async function translateFile(
  options: TranslateOptions & { locale: string },
): Promise<TranslateResult> {
  validateBatchSize(options.batchSize === undefined ? DEFAULT_BATCH_SIZE : options.batchSize)

  const ext = extname(options.input).toLowerCase()

  if (ext === '.txt') {
    return translateReadmeFile(options)
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

  const resolvedKey = apiKey ?? process.env.OPENROUTER_API_KEY
  if (!resolvedKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY or pass apiKey option.',
    )
  }

  const openrouter = createOpenRouter({ apiKey: resolvedKey })
  const model = openrouter.chat(modelId)
  const targetLanguage = localeToLanguageName(locale)
  const outputPath = resolveOutputPath(input, locale, output)

  const po = loadPO(input)
  const localeMetadata = localeMetadataFor(locale)
  const pluralFormCount = localeMetadata.pluralFormCount
  po.setLocale(locale)

  const translationJobs: TranslationJob[] = []
  const selectedEntries = new Set<POEntry>()

  for (const entry of po.entries) {
    if (entry.msgid_plural) {
      entry.msgstrs.length = pluralFormCount
      for (let formIndex = 0; formIndex < pluralFormCount; formIndex++) {
        entry.msgstrs[formIndex] ??= ''
      }
    }

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

      translationJobs.push({ entry, formIndex, extracted, requestItem })
      selectedEntries.add(entry)
    }
  }

  const total = selectedEntries.size
  const skipped = po.entries.length - total

  const emptyUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (total === 0) {
    po.save(outputPath)
    return { locale, output: outputPath, translated: 0, skipped, usage: emptyUsage }
  }

  // Split translation jobs into batches.
  const batches: number[][] = []
  for (let i = 0; i < translationJobs.length; i += batchSize) {
    batches.push(
      Array.from({ length: Math.min(batchSize, translationJobs.length - i) }, (_, j) => i + j),
    )
  }

  let translated = 0
  let promptTokens = 0
  let completionTokens = 0
  const remainingJobs = new Map<POEntry, number>()
  for (const job of translationJobs) {
    remainingJobs.set(job.entry, (remainingJobs.get(job.entry) ?? 0) + 1)
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const indices = batches[batchIndex]
    const items = indices.map((i) => translationJobs[i].requestItem)

    const result = await translateBatch(items, targetLanguage, model, context)

    promptTokens += result.promptTokens
    completionTokens += result.completionTokens

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

    onProgress?.({
      locale,
      translated,
      total,
      batch: batchIndex + 1,
      batches: batches.length,
    })
  }

  po.save(outputPath)

  const totalTokens = promptTokens + completionTokens
  const estimatedCostUsd = estimateCost(modelId, promptTokens, completionTokens)

  return {
    locale,
    output: outputPath,
    translated,
    skipped,
    usage: { promptTokens, completionTokens, totalTokens, estimatedCostUsd },
  }
}

export async function translate(options: TranslateOptions): Promise<TranslateResult[]> {
  return Promise.all(planTranslationJobs(options).map((job) => translateFile(job)))
}
