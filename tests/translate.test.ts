import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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

import { generateObject } from 'ai'
import { translateFile } from '../src/translate.js'

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
    return { object: { translations } } as any
  })
}

describe('translateFile', () => {
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
