import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateObject } from 'ai'
import { z } from 'zod'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { extractVariables, restoreVariables } from './variables.js'
import { loadPO, localeToLanguageName } from './po.js'
import type { TranslateOptions, TranslateResult } from './types.js'

const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku'
const DEFAULT_BATCH_SIZE = 40

const translationsSchema = z.object({
  translations: z
    .array(z.string())
    .describe('Translated strings in the same order as the input array'),
})

function buildSystemPrompt(targetLanguage: string, context?: string): string {
  const contextLine = context
    ? `\nProject context: ${context}`
    : ''

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
): Promise<string[]> {
  const { object } = await generateObject({
    model,
    schema: translationsSchema,
    messages: [
      { role: 'system', content: buildSystemPrompt(targetLanguage, context) },
      {
        role: 'user',
        content: JSON.stringify(strings),
      },
    ],
  })

  if (object.translations.length !== strings.length) {
    throw new Error(
      `AI returned ${object.translations.length} translations for ${strings.length} inputs`,
    )
  }

  return object.translations
}

function resolveOutputPath(input: string, locale: string, output?: string): string {
  if (output) return resolve(output)

  const dir = dirname(resolve(input))
  const ext = extname(input)
  const name = basename(input, ext)

  // If the input is already a .po file containing the locale, write back in place
  if (ext === '.po' && name.endsWith(`-${locale}`)) {
    return resolve(input)
  }

  // Otherwise append the locale suffix (e.g. "leat-crm.pot" → "leat-crm-nl_NL.po")
  return join(dir, `${name}-${locale}.po`)
}

export async function translateFile(
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

  if (total === 0) {
    po.save(outputPath)
    return { locale, output: outputPath, translated: 0, skipped }
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

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const indices = batches[batchIndex]
    const templates = indices.map((i) => extracted[i].template)

    const results = await translateBatch(templates, targetLanguage, model, context)

    for (let j = 0; j < indices.length; j++) {
      const entryIndex = indices[j]
      const restored = restoreVariables(results[j], extracted[entryIndex].vars)
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

  return { locale, output: outputPath, translated, skipped }
}

export async function translate(options: TranslateOptions): Promise<TranslateResult[]> {
  const locales = Array.isArray(options.locale) ? options.locale : [options.locale]
  return Promise.all(locales.map((locale) => translateFile({ ...options, locale })))
}
