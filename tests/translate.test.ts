import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock the AI SDK — we don't want real API calls in unit tests
// ---------------------------------------------------------------------------
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => ({
    chat: vi.fn(() => 'mock-model'),
  })),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('citty', () => ({
  defineCommand: vi.fn((command) => command),
  runMain: vi.fn(),
}))

import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { translate, translateFile } from '../src/translate.js'

const UNTRANSLATED_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: nl_NL\\n"

msgid "Save settings"
msgstr ""

msgid "Cancel"
msgstr ""

msgid "Error"
msgstr ""
`.trim()

const WITH_VARS_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "You have {{credits}} {{credits_currency}}"
msgstr ""

msgid "Earn %s points"
msgstr ""
`.trim()

const PARTIALLY_TRANSLATED_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Save settings"
msgstr "Instellingen opslaan"

msgid "Cancel"
msgstr ""
`.trim()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'po-genie-translate-'))
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function mockAI(responses: string[][]) {
  let call = 0
  vi.mocked(generateObject).mockImplementation(async () => {
    const translations = responses[call++] ?? []
    return {
      object: { translations },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as any
  })
}

describe('translateFile', () => {
  it.each([
    ['abc', Number.NaN],
    ['2.5', 2.5],
    ['0', 0],
    ['-1', -1],
  ])('keeps invalid --batch-size text intact for shared validation: %s', async (value, expected) => {
    const { parseBatchSize } = await import('../src/cli.js')

    const actual = parseBatchSize(value)
    if (Number.isNaN(expected)) {
      expect(actual).toSatisfy(Number.isNaN)
      return
    }
    expect(actual).toBe(expected)
  })

  it('translates all empty msgstr entries and writes output', async () => {
    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren', 'Fout']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result.translated).toBe(3)
    expect(result.skipped).toBe(0)

    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('msgstr "Instellingen opslaan"')
    expect(saved).toContain('msgstr "Annuleren"')
    expect(saved).toContain('msgstr "Fout"')
  })

  it('restores variables in translated output', async () => {
    const input = join(tmpDir, 'vars.po')
    writeFileSync(input, WITH_VARS_PO)
    // AI returns translations with token placeholders preserved
    mockAI([['Je hebt [VAR_0] [VAR_1]', 'Verdien [VAR_0] punten']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('{{credits}}')
    expect(saved).toContain('{{credits_currency}}')
    expect(saved).toContain('%s')
  })

  it('skips already-translated entries when onlyMissing is true (default)', async () => {
    const input = join(tmpDir, 'partial.po')
    writeFileSync(input, PARTIALLY_TRANSLATED_PO)
    mockAI([['Annuleren']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result.translated).toBe(1)
    expect(result.skipped).toBe(1)
    expect(generateObject).toHaveBeenCalledTimes(1)

    // Pre-existing translation must be preserved
    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('msgstr "Instellingen opslaan"')
  })

  it('re-translates everything when onlyMissing is false', async () => {
    const input = join(tmpDir, 'partial.po')
    writeFileSync(input, PARTIALLY_TRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onlyMissing: false,
    })

    expect(result.translated).toBe(2)
    expect(result.skipped).toBe(0)
  })

  it('defaults output path to <input-dir>/<name>-<locale>.po for .pot input', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren', 'Fout']])

    const result = await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })

    expect(result.output).toBe(join(tmpDir, 'messages-nl_NL.po'))
  })

  it('writes back in-place when input is already a locale .po file', async () => {
    const input = join(tmpDir, 'messages-nl_NL.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren', 'Fout']])

    const result = await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })

    expect(result.output).toBe(input)
  })

  it('uses explicit output path when provided', async () => {
    const input = join(tmpDir, 'input.po')
    const output = join(tmpDir, 'custom-output.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren', 'Fout']])

    const result = await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key', output })

    expect(result.output).toBe(output)
  })

  it('reports progress after each batch', async () => {
    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan', 'Annuleren', 'Fout']])

    const progress: number[] = []
    await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onProgress: (p) => progress.push(p.translated),
    })

    expect(progress).toEqual([3])
  })

  it('splits into multiple batches when batchSize is small', async () => {
    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan'], ['Annuleren'], ['Fout']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })

    expect(result.translated).toBe(3)
    expect(generateObject).toHaveBeenCalledTimes(3)
  })

  it.each([
    { batchSize: 0, error: 'batchSize must be a positive integer' },
    { batchSize: -1, error: 'batchSize must be a positive integer' },
    { batchSize: Number.NaN, error: 'batchSize must be a positive integer' },
    { batchSize: 1.5, error: 'batchSize must be a positive integer' },
    { batchSize: 1, calls: 3 },
  ])('validates batchSize $batchSize before translating PO entries', async ({ batchSize, error, calls }) => {
    if (error) {
      delete process.env.OPENROUTER_API_KEY
      const translation = translateFile({ input: 'input.po', locale: 'nl_NL', batchSize })
      await expect(translation).rejects.toThrow(error)
      expect(generateObject).not.toHaveBeenCalled()
      return
    }

    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Instellingen opslaan'], ['Annuleren'], ['Fout']])
    const translation = translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize,
    })

    await expect(translation).resolves.toMatchObject({ translated: 3 })
    expect(generateObject).toHaveBeenCalledTimes(calls)
  })

  it('throws when API key is missing', async () => {
    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    delete process.env.OPENROUTER_API_KEY

    await expect(
      translateFile({ input, locale: 'nl_NL' }),
    ).rejects.toThrow('OpenRouter API key is required')
  })

  it('returns zero translated when there is nothing to translate', async () => {
    const nothingMissing = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Save"
msgstr "Opslaan"
`.trim()

    const input = join(tmpDir, 'done.po')
    writeFileSync(input, nothingMissing)

    const result = await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })

    expect(result.translated).toBe(0)
    expect(generateObject).not.toHaveBeenCalled()
  })
})

describe('translate with multiple locales', () => {
  it('keeps an explicit output as the exact file path for one locale', async () => {
    const input = join(tmpDir, 'messages.pot')
    const output = join(tmpDir, 'custom.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Opslaan', 'Annuleren', 'Fout']])

    const [result] = await translate({
      input,
      locale: 'nl_NL',
      output,
      apiKey: 'test-key',
    })

    expect(result.output).toBe(output)
    expect(readFileSync(output, 'utf-8')).toContain('msgstr "Opslaan"')
  })

  it('rejects duplicate normalized locales before requesting translations', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: ['nl_NL', ' nl_NL '],
      apiKey: 'test-key',
    })).rejects.toThrow('Duplicate locale: nl_NL')

    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects case and separator equivalent locales before creating a provider', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: ['nl_NL', 'NL-nl'],
      apiKey: 'test-key',
    })).rejects.toThrow('Duplicate locale: nl_NL')

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects traversal-like locale input before creating a provider', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: ['nl_NL', '../de_DE'],
      apiKey: 'test-key',
    })).rejects.toThrow('Invalid locale: ../de_DE')

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects an empty locale before requesting translations', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: ['nl_NL', '  '],
      apiKey: 'test-key',
    })).rejects.toThrow('Locale must not be empty')

    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects an empty locale array before creating a provider', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: [],
      apiKey: 'test-key',
    })).rejects.toThrow('At least one locale is required')

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects a missing multi-locale output directory before creating a provider', async () => {
    const input = join(tmpDir, 'messages.pot')
    const output = join(tmpDir, 'missing-translations')
    writeFileSync(input, UNTRANSLATED_PO)

    await expect(translate({
      input,
      locale: ['nl_NL', 'de_DE'],
      output,
      apiKey: 'test-key',
    })).rejects.toThrow(`Multi-locale output directory must exist: ${output}`)

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rejects a file used as a multi-locale output directory before creating a provider', async () => {
    const input = join(tmpDir, 'messages.pot')
    const output = join(tmpDir, 'not-a-directory')
    writeFileSync(input, UNTRANSLATED_PO)
    writeFileSync(output, 'not a directory')

    await expect(translate({
      input,
      locale: ['nl_NL', 'de_DE'],
      output,
      apiKey: 'test-key',
    })).rejects.toThrow(`Multi-locale output must be a directory: ${output}`)

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('writes stable, distinct default POT outputs for multiple locales', async () => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([
      ['Opslaan', 'Annuleren', 'Fout'],
      ['Speichern', 'Abbrechen', 'Fehler'],
    ])

    const results = await translate({ input, locale: ['nl_NL', 'de_DE'], apiKey: 'test-key' })

    expect(results.map((result) => result.locale)).toEqual(['nl_NL', 'de_DE'])
    expect(results.map((result) => result.output)).toEqual([
      join(tmpDir, 'messages-nl_NL.po'),
      join(tmpDir, 'messages-de_DE.po'),
    ])
    expect(new Set(results.map((result) => result.output)).size).toBe(2)
    expect(readFileSync(join(tmpDir, 'messages-nl_NL.po'), 'utf-8')).toContain('msgstr "Opslaan"')
    expect(readFileSync(join(tmpDir, 'messages-de_DE.po'), 'utf-8')).toContain('msgstr "Speichern"')
  })

  it('writes stable, distinct default PO outputs for multiple locales', async () => {
    const input = join(tmpDir, 'messages.po')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([
      ['Opslaan', 'Annuleren', 'Fout'],
      ['Speichern', 'Abbrechen', 'Fehler'],
    ])

    const results = await translate({ input, locale: ['nl_NL', 'de_DE'], apiKey: 'test-key' })

    expect(results.map((result) => result.locale)).toEqual(['nl_NL', 'de_DE'])
    expect(results.map((result) => result.output)).toEqual([
      join(tmpDir, 'messages-nl_NL.po'),
      join(tmpDir, 'messages-de_DE.po'),
    ])
    expect(new Set(results.map((result) => result.output)).size).toBe(2)
    expect(readFileSync(join(tmpDir, 'messages-nl_NL.po'), 'utf-8')).toContain('msgstr "Opslaan"')
    expect(readFileSync(join(tmpDir, 'messages-de_DE.po'), 'utf-8')).toContain('msgstr "Speichern"')
  })

  it('treats an explicit output as a directory and writes one PO file per locale', async () => {
    const input = join(tmpDir, 'messages.pot')
    const output = join(tmpDir, 'translations')
    mkdirSync(output)
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([
      ['Opslaan', 'Annuleren', 'Fout'],
      ['Speichern', 'Abbrechen', 'Fehler'],
    ])

    const results = await translate({
      input,
      locale: ['nl_NL', 'de_DE'],
      output,
      apiKey: 'test-key',
    })

    expect(results.map((result) => result.locale)).toEqual(['nl_NL', 'de_DE'])
    expect(results.map((result) => result.output)).toEqual([
      join(output, 'messages-nl_NL.po'),
      join(output, 'messages-de_DE.po'),
    ])
    expect(readFileSync(join(output, 'messages-nl_NL.po'), 'utf-8')).toContain('msgstr "Opslaan"')
    expect(readFileSync(join(output, 'messages-de_DE.po'), 'utf-8')).toContain('msgstr "Speichern"')
  })
})
