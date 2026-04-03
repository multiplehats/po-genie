import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateObject } from 'ai'
import { z } from 'zod'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { extractVariables, restoreVariables } from './variables.js'
import { loadPO, localeToLanguageName } from './po.js'
import { loadReadme } from './readme.js'
import type { ReadmeSegment } from './readme.js'
import type { TranslateOptions, TranslateResult, TokenUsage } from './types.js'

const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku'
const DEFAULT_BATCH_SIZE = 40

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

function buildSystemPrompt(targetLanguage: string, context?: string): string {
  const contextLine = context ? `\nProject context: ${context}` : ''

  return `You are a professional software localisation translator.
Translate UI strings from English to ${targetLanguage}.${contextLine}

Rules:
- Preserve variable tokens like [VAR_0], [VAR_1], etc. exactly as-is — they are runtime placeholders
- Preserve printf specifiers (%s, %d) if any remain untokenised
- Keep HTML tags unchanged
- Match the tone: concise for labels/buttons, natural for descriptions
- Do not add or remove punctuation unless required by the target language
- Return ONLY the translated strings array — no explanations`
}

async function translateBatch(
  strings: string[],
  targetLanguage: string,
  model: ReturnType<ReturnType<typeof createOpenRouter>['chat']>,
  context?: string,
): Promise<{ translations: string[]; promptTokens: number; completionTokens: number }> {
  const { object, usage } = await generateObject({
    model,
    schema: translationsSchema,
    messages: [
      { role: 'system', content: buildSystemPrompt(targetLanguage, context) },
      { role: 'user', content: JSON.stringify(strings) },
    ],
  })

  if (object.translations.length !== strings.length) {
    throw new Error(
      `AI returned ${object.translations.length} translations for ${strings.length} inputs`,
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

function buildReadmeSystemPrompt(targetLanguage: string): string {
  return `You are translating a WordPress plugin readme file into ${targetLanguage}.

Rules:
- Translate the text naturally and accurately
- Preserve all markdown formatting (bold, italic, links, lists)
- Keep URLs unchanged — do not translate URLs
- Keep code references unchanged (e.g. file paths, function names, CSS classes)
- Keep [VAR_0], [VAR_1] etc. placeholders exactly as-is
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

  // Extract variables and build templates for each segment
  const extracted = translatableSegments.map((seg) => extractVariables(seg.content))

  // Prepend context hints to templates for the AI
  const templatesWithContext = translatableSegments.map((seg, i) => {
    const ctx = seg.context
    return ctx ? `[context: ${ctx}] ${extracted[i].template}` : extracted[i].template
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
    const templates = indices.map((i) => templatesWithContext[i])

    const { object, usage } = await generateObject({
      model,
      schema: translationsSchema,
      messages: [
        { role: 'system', content: systemPrompt + contextLine },
        { role: 'user', content: JSON.stringify(templates) },
      ],
    })

    if (object.translations.length !== templates.length) {
      throw new Error(
        `AI returned ${object.translations.length} translations for ${templates.length} inputs`,
      )
    }

    promptTokens += usage.promptTokens
    completionTokens += usage.completionTokens

    for (let j = 0; j < indices.length; j++) {
      const entryIndex = indices[j]
      const restored = restoreVariables(object.translations[j], extracted[entryIndex].vars)
      translatableSegments[entryIndex].translated = restored
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

  const toTranslate = onlyMissing
    ? po.entries.filter((e) => !e.msgstr)
    : po.entries

  const total = toTranslate.length
  const skipped = po.entries.length - total

  const emptyUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (total === 0) {
    po.save(outputPath)
    return { locale, output: outputPath, translated: 0, skipped, usage: emptyUsage }
  }

  // Extract variables and build templates for each entry
  const extracted = toTranslate.map((entry) => extractVariables(entry.msgid))

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

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const indices = batches[batchIndex]
    const templates = indices.map((i) => extracted[i].template)

    const result = await translateBatch(templates, targetLanguage, model, context)

    promptTokens += result.promptTokens
    completionTokens += result.completionTokens

    for (let j = 0; j < indices.length; j++) {
      const entryIndex = indices[j]
      const restored = restoreVariables(result.translations[j], extracted[entryIndex].vars)
      toTranslate[entryIndex]._item.msgstr = [restored]
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
  const locales = Array.isArray(options.locale) ? options.locale : [options.locale]
  return Promise.all(locales.map((locale) => translateFile({ ...options, locale })))
}
