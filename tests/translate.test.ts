import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import gettextParser from 'gettext-parser'

// ---------------------------------------------------------------------------
// Mock the AI SDK — we don't want real API calls in unit tests
// ---------------------------------------------------------------------------
vi.mock('../src/po.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/po.js')>()
  return {
    ...actual,
    loadPO: vi.fn(actual.loadPO),
  }
})

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
import { loadPO } from '../src/po.js'
import {
  checkpointPathForOutput,
  createCheckpointIdentity,
  saveCheckpoint,
} from '../src/checkpoint.js'
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

const WITH_PROTECTED_FRAGMENTS_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Read <strong>[the docs](https://example.com/docs)</strong> with \`tool --help\`."
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

const CONTEXTUAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgctxt "verb"
msgid "Save"
msgstr ""

msgctxt "noun"
msgid "Save"
msgstr ""

msgid "Cancel"
msgstr ""
`.trim()

const STALE_LANGUAGE_PO = `
msgid ""
msgstr ""
"Project-Id-Version: po-genie test\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: en_US\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "File"
msgstr ""
`.trim()

const TWO_FORM_PLURAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgctxt "cart"
msgid "One item"
msgid_plural "Many items"
msgstr[0] ""
msgstr[1] ""
`.trim()

const THREE_FORM_PLURAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "One file"
msgid_plural "Many files"
msgstr[0] ""
msgstr[1] ""
`.trim()

const PARTIAL_THREE_FORM_PLURAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgctxt "storage"
msgid "One file"
msgid_plural "Many files"
msgstr[0] "Jeden plik"
msgstr[1] ""
msgstr[2] "Wiele plików"
`.trim()

const EXTRA_SLOT_PLURAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "One file"
msgid_plural "Many files"
msgstr[0] "Eén bestand"
msgstr[1] "Meerdere bestanden"
msgstr[2] "Extra vorm"
`.trim()

const POSITIONAL_PLURAL_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Move %1$s into %2$s"
msgid_plural "Move %2$s items into %1$s"
msgstr[0] ""
msgstr[1] ""
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

function readHeaders(file: string): Record<string, string> {
  return gettextParser.po.parse(readFileSync(file)).headers
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

    const headers = readHeaders(result.output)
    expect(headers.Language).toBe('nl_NL')
    expect(headers['Plural-Forms']).toBe('nplurals=2; plural=(n != 1);')
  })

  it('sets Polish metadata on the normal translated save path and preserves other headers', async () => {
    const input = join(tmpDir, 'messages.po')
    writeFileSync(input, STALE_LANGUAGE_PO)
    mockAI([['Plik']])

    const result = await translateFile({
      input,
      locale: 'pl_PL',
      apiKey: 'test-key',
    })

    const headers = readHeaders(result.output)
    expect(headers.Language).toBe('pl_PL')
    expect(headers['Plural-Forms']).toBe(
      'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    )
    expect(headers['Project-Id-Version']).toBe('po-genie test')
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

  it('protects and restores immutable source fragments while translating a Markdown label', async () => {
    const input = join(tmpDir, 'protected.po')
    writeFileSync(input, WITH_PROTECTED_FRAGMENTS_PO)
    mockAI([[
      'Lees [IMM_0][de documentatie]([IMM_1])[IMM_2] met [IMM_3].',
    ]])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const request = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(request.messages![1].content as string)).toEqual([
      { template: 'Read [IMM_0][the docs]([IMM_1])[IMM_2] with [IMM_3].' },
    ])

    const savedEntry = loadPO(result.output).entries[0]
    expect(savedEntry.msgstr).toBe(
      'Lees <strong>[de documentatie](https://example.com/docs)</strong> met `tool --help`.',
    )
  })

  it('rejects an invalid token anywhere in a batch before writing output or reporting progress', async () => {
    const input = join(tmpDir, 'vars.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, WITH_VARS_PO)
    mockAI([['Je hebt [VAR_0] [VAR_1]', 'Verdien punten']])
    const progress: number[] = []

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onProgress: (event) => progress.push(event.translated),
    })).rejects.toThrow(/nl_NL.*batch 1.*item 2.*VAR_0/)

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(existsSync(output)).toBe(false)
    expect(existsSync(checkpointPathForOutput(output))).toBe(false)
    expect(progress).toEqual([])
  })

  it('round-trips literal token text, runtime variables, and complex immutable fragments together', async () => {
    const content = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Keep [VAR_0] and %s. Read [wiki](https://example.com/Foo_(bar)) with \`\`foo \`bar\` baz\`\` in <span title=\\"a > b\\">this</span>."
msgstr ""
`.trim()
    const input = join(tmpDir, 'collisions.po')
    writeFileSync(input, content)
    mockAI([[
      'Behoud [VAR_0] en [VAR1_0]. Lees [wiki]([IMM_0]) met [IMM_1] in [IMM_2]dit[IMM_3].',
    ]])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(loadPO(result.output).entries[0].msgstr).toBe(
      'Behoud [VAR_0] en %s. Lees [wiki](https://example.com/Foo_(bar)) met ``foo `bar` baz`` in <span title="a > b">dit</span>.',
    )
  })

  it('sends gettext contexts as metadata and saves translations under their original contexts', async () => {
    const input = join(tmpDir, 'contextual.po')
    writeFileSync(input, CONTEXTUAL_PO)
    mockAI([['Annuleren', 'Opslaan', 'Bewaring']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const request = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(request.messages![1].content as string)).toEqual([
      { template: 'Cancel' },
      { template: 'Save', msgctxt: 'verb' },
      { template: 'Save', msgctxt: 'noun' },
    ])

    const saved = loadPO(result.output)
    expect(saved.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ msgid: 'Save', msgctxt: 'verb', msgstr: 'Opslaan' }),
      expect.objectContaining({ msgid: 'Save', msgctxt: 'noun', msgstr: 'Bewaring' }),
      expect.objectContaining({ msgid: 'Cancel', msgctxt: undefined, msgstr: 'Annuleren' }),
    ]))
  })

  it('translates every required two-form slot and keeps plural metadata structured', async () => {
    const input = join(tmpDir, 'plural.po')
    writeFileSync(input, TWO_FORM_PLURAL_PO)
    mockAI([['Eén item', 'Meerdere items']])

    const progress: Array<{ translated: number; total: number }> = []
    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onProgress: ({ translated, total }) => progress.push({ translated, total }),
    })

    const request = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(request.messages![1].content as string)).toEqual([
      {
        template: 'One item',
        singularSource: 'One item',
        pluralSource: 'Many items',
        formIndex: 0,
        formCount: 2,
        pluralForms: 'nplurals=2; plural=(n != 1);',
        msgctxt: 'cart',
      },
      {
        template: 'Many items',
        singularSource: 'One item',
        pluralSource: 'Many items',
        formIndex: 1,
        formCount: 2,
        pluralForms: 'nplurals=2; plural=(n != 1);',
        msgctxt: 'cart',
      },
    ])

    expect(result).toMatchObject({ translated: 1, skipped: 0 })
    expect(progress).toEqual([{ translated: 1, total: 1 }])
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Eén item',
      'Meerdere items',
    ])
  })

  it('uses target locale form count and reports completion only after all entry jobs apply', async () => {
    const input = join(tmpDir, 'plural.po')
    writeFileSync(input, THREE_FORM_PLURAL_PO)
    mockAI([['Jeden plik'], ['Pliki'], ['Wiele plików']])

    const progress: Array<{ translated: number; total: number }> = []
    const result = await translateFile({
      input,
      locale: 'pl_PL',
      apiKey: 'test-key',
      batchSize: 1,
      onProgress: ({ translated, total }) => progress.push({ translated, total }),
    })

    expect(generateObject).toHaveBeenCalledTimes(3)
    expect(progress).toEqual([
      { translated: 0, total: 1 },
      { translated: 0, total: 1 },
      { translated: 1, total: 1 },
    ])
    expect(result).toMatchObject({
      translated: 1,
      skipped: 0,
      usage: { promptTokens: 300, completionTokens: 150, totalTokens: 450 },
    })
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Jeden plik',
      'Pliki',
      'Wiele plików',
    ])
  })

  it('supplies the validated locale rule when equal form counts use different mappings', async () => {
    const input = join(tmpDir, 'plural.po')
    writeFileSync(input, TWO_FORM_PLURAL_PO)
    mockAI([
      ['Eén item', 'Meerdere items'],
      ['Un élément', 'Plusieurs éléments'],
    ])

    await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })
    await translateFile({ input, locale: 'fr_FR', apiKey: 'test-key' })

    const dutchItems = JSON.parse(
      vi.mocked(generateObject).mock.calls[0][0].messages![1].content as string,
    )
    const frenchItems = JSON.parse(
      vi.mocked(generateObject).mock.calls[1][0].messages![1].content as string,
    )
    expect(dutchItems[0]).toMatchObject({
      formCount: 2,
      pluralForms: 'nplurals=2; plural=(n != 1);',
    })
    expect(frenchItems[0]).toMatchObject({
      formCount: 2,
      pluralForms: 'nplurals=2; plural=(n > 1);',
    })
  })

  it('keeps raw companion sources unambiguous when positional placeholders reorder', async () => {
    const input = join(tmpDir, 'positional.po')
    writeFileSync(input, POSITIONAL_PLURAL_PO)
    mockAI([[
      'Verplaats [VAR_0] naar [VAR_1]',
      'Verplaats [VAR_0] items naar [VAR_1]',
    ]])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const request = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(request.messages![1].content as string)).toEqual([
      {
        template: 'Move [VAR_0] into [VAR_1]',
        singularSource: 'Move %1$s into %2$s',
        pluralSource: 'Move %2$s items into %1$s',
        formIndex: 0,
        formCount: 2,
        pluralForms: 'nplurals=2; plural=(n != 1);',
      },
      {
        template: 'Move [VAR_0] items into [VAR_1]',
        singularSource: 'Move %1$s into %2$s',
        pluralSource: 'Move %2$s items into %1$s',
        formIndex: 1,
        formCount: 2,
        pluralForms: 'nplurals=2; plural=(n != 1);',
      },
    ])
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Verplaats %1$s naar %2$s',
      'Verplaats %2$s items naar %1$s',
    ])
  })

  it('translates only missing required plural slots and preserves completed forms', async () => {
    const input = join(tmpDir, 'partial-plural.po')
    writeFileSync(input, PARTIAL_THREE_FORM_PLURAL_PO)
    mockAI([['Pliki']])

    const result = await translateFile({
      input,
      locale: 'pl_PL',
      apiKey: 'test-key',
    })

    const request = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(request.messages![1].content as string)).toEqual([
      {
        template: 'Many files',
        singularSource: 'One file',
        pluralSource: 'Many files',
        formIndex: 1,
        formCount: 3,
        pluralForms: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
        msgctxt: 'storage',
      },
    ])
    expect(result).toMatchObject({ translated: 1, skipped: 0 })
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Jeden plik',
      'Pliki',
      'Wiele plików',
    ])
  })

  it('removes extra plural slots on the zero-job onlyMissing save path', async () => {
    const input = join(tmpDir, 'extra-slots.po')
    writeFileSync(input, EXTRA_SLOT_PLURAL_PO)

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result).toMatchObject({ translated: 0, skipped: 1 })
    expect(generateObject).not.toHaveBeenCalled()
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Eén bestand',
      'Meerdere bestanden',
    ])
  })

  it('replaces every required plural slot when onlyMissing is false', async () => {
    const input = join(tmpDir, 'partial-plural.po')
    writeFileSync(input, PARTIAL_THREE_FORM_PLURAL_PO)
    mockAI([['Nowy jeden plik', 'Nowe pliki', 'Nowych plików']])

    const result = await translateFile({
      input,
      locale: 'pl_PL',
      apiKey: 'test-key',
      onlyMissing: false,
    })

    expect(result).toMatchObject({ translated: 1, skipped: 0 })
    expect(loadPO(result.output).entries[0].msgstrs).toEqual([
      'Nowy jeden plik',
      'Nowe pliki',
      'Nowych plików',
    ])
  })

  it('rejects a plural response count mismatch before applying or saving the batch', async () => {
    const input = join(tmpDir, 'messages-nl_NL.po')
    writeFileSync(input, TWO_FORM_PLURAL_PO)
    mockAI([['Eén item']])

    await expect(translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })).rejects.toThrow('AI returned 1 translations for 2 inputs')

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(existsSync(checkpointPathForOutput(input))).toBe(false)
    expect(loadPO(input).entries[0].msgstrs).toEqual(['', ''])
  })

  it('leaves loaded plural slots untouched when protected-token validation rejects the batch', async () => {
    const input = join(tmpDir, 'positional.po')
    writeFileSync(input, POSITIONAL_PLURAL_PO)

    const originalLoadPO = vi.mocked(loadPO).getMockImplementation()
    if (!originalLoadPO) throw new Error('Expected loadPO mock implementation')
    const po = originalLoadPO(input)
    vi.mocked(loadPO).mockReturnValueOnce(po)
    mockAI([[
      'Przenieś [VAR_0] do [VAR_1]',
      'Przenieś [VAR_0] elementy do [VAR_1]',
      'Przenieś elementy',
    ]])

    await expect(translateFile({
      input,
      locale: 'pl_PL',
      apiKey: 'test-key',
    })).rejects.toThrow(/item 3.*VAR_[01]/)

    expect(po.entries[0].msgstrs).toEqual(['', ''])
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

  it('checkpoints only the first validated PO batch when the second batch fails', async () => {
    const input = join(tmpDir, 'input.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, UNTRANSLATED_PO)
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Eerste vertaling'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockRejectedValueOnce(Object.assign(new Error('bad request'), {
        statusCode: 400,
      }))
    const progress: number[] = []

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'sk-never-persist',
      context: 'private checkout context',
      batchSize: 1,
      onProgress: ({ translated }) => progress.push(translated),
    })).rejects.toThrow('bad request')

    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(existsSync(output)).toBe(false)
    expect(progress).toEqual([1])

    const checkpointPath = checkpointPathForOutput(output)
    const serialized = readFileSync(checkpointPath, 'utf8')
    const checkpoint = JSON.parse(serialized)
    expect(checkpoint.completedItemIds).toHaveLength(1)
    expect(Object.values(checkpoint.translations)).toEqual(['Eerste vertaling'])
    expect(checkpoint.usage).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    })
    expect(checkpoint.usage.estimatedCostUsd).toBeCloseTo(0.00028)
    expect(serialized).not.toContain('sk-never-persist')
    expect(serialized).not.toContain('private checkout context')
    expect(serialized).not.toContain('Save settings')
    expect(serialized).not.toContain('professional software')
  })

  it('resumes PO work without requesting completed jobs twice', async () => {
    const input = join(tmpDir, 'input.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, UNTRANSLATED_PO)
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Instellingen opslaan'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockRejectedValueOnce(Object.assign(new Error('bad request'), {
        statusCode: 400,
      }))

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })).rejects.toThrow('bad request')
    expect(existsSync(checkpointPathForOutput(output))).toBe(true)

    vi.mocked(generateObject).mockReset()
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Annuleren'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockResolvedValueOnce({
        object: { translations: ['Fout'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
    const progress: number[] = []

    const result = await translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
      onProgress: ({ translated }) => progress.push(translated),
    })

    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(progress).toEqual([2, 3])
    expect(result).toMatchObject({
      translated: 3,
      skipped: 0,
      usage: { promptTokens: 300, completionTokens: 150, totalTokens: 450 },
    })
    expect(loadPO(output).entries.map(({ msgid, msgstr }) => [msgid, msgstr])).toEqual([
      ['Save settings', 'Instellingen opslaan'],
      ['Cancel', 'Annuleren'],
      ['Error', 'Fout'],
    ])
    expect(existsSync(checkpointPathForOutput(output))).toBe(false)
  })

  it.each([
    {
      case: 'stale source',
      prepare(input: string, output: string) {
        saveCheckpoint(output, createCheckpointIdentity({
          source: readFileSync(input),
          targetLocale: 'nl_NL',
          pipeline: 'po',
          model: 'anthropic/claude-3.5-haiku',
          batchSize: 1,
          onlyMissing: true,
        }), {
          completedItemIds: [],
          translations: {},
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        })
        writeFileSync(input, `${UNTRANSLATED_PO}\n# source changed`)
      },
      error: /identity mismatch.*sourceSha256/i,
    },
    {
      case: 'corrupt JSON',
      prepare(_input: string, output: string) {
        writeFileSync(checkpointPathForOutput(output), '{"schemaVersion":1,broken')
      },
      error: /corrupt JSON/i,
    },
    {
      case: 'option mismatch',
      prepare(input: string, output: string) {
        saveCheckpoint(output, createCheckpointIdentity({
          source: readFileSync(input),
          targetLocale: 'nl_NL',
          pipeline: 'po',
          model: 'anthropic/claude-3.5-haiku',
          batchSize: 2,
          onlyMissing: true,
        }), {
          completedItemIds: [],
          translations: {},
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        })
      },
      error: /identity mismatch.*batchSize/i,
    },
    {
      case: 'unknown completed item',
      prepare(input: string, output: string) {
        saveCheckpoint(output, createCheckpointIdentity({
          source: readFileSync(input),
          targetLocale: 'nl_NL',
          pipeline: 'po',
          model: 'anthropic/claude-3.5-haiku',
          batchSize: 1,
          onlyMissing: true,
        }), {
          completedItemIds: ['po:not-a-selected-job'],
          translations: { 'po:not-a-selected-job': 'Onbekend' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        })
      },
      error: /does not match the selected PO jobs/i,
    },
  ])('rejects a $case checkpoint before creating the PO provider', async ({ prepare, error }) => {
    const input = join(tmpDir, 'input.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, UNTRANSLATED_PO)
    writeFileSync(output, 'existing output bytes')
    prepare(input, output)
    const checkpointPath = checkpointPathForOutput(output)
    const checkpointBytes = readFileSync(checkpointPath)
    const outputBytes = readFileSync(output)

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })).rejects.toThrow(error)

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
    expect(readFileSync(checkpointPath)).toEqual(checkpointBytes)
    expect(readFileSync(output)).toEqual(outputBytes)
  })

  it('revalidates protected PO checkpoint text before applying it', async () => {
    const input = join(tmpDir, 'vars.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, WITH_VARS_PO)
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Je hebt [VAR_0] [VAR_1]'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockRejectedValueOnce(Object.assign(new Error('bad request'), {
        statusCode: 400,
      }))

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })).rejects.toThrow('bad request')

    const checkpointPath = checkpointPathForOutput(output)
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    checkpoint.translations[checkpoint.completedItemIds[0]] = 'Geen beschermde tokens'
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
    const editedBytes = readFileSync(checkpointPath)
    vi.clearAllMocks()

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })).rejects.toThrow(/invalid protected translation/i)

    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
    expect(existsSync(output)).toBe(false)
    expect(readFileSync(checkpointPath)).toEqual(editedBytes)
  })

  it('finishes a zero-job PO with a matching empty checkpoint without a provider', async () => {
    const input = join(tmpDir, 'complete.po')
    const output = join(tmpDir, 'translated.po')
    writeFileSync(input, EXTRA_SLOT_PLURAL_PO)
    saveCheckpoint(output, createCheckpointIdentity({
      source: readFileSync(input),
      targetLocale: 'nl_NL',
      pipeline: 'po',
      model: 'anthropic/claude-3.5-haiku',
      batchSize: 40,
      onlyMissing: true,
    }), {
      completedItemIds: [],
      translations: {},
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })

    const result = await translateFile({ input, output, locale: 'nl_NL' })

    expect(result).toMatchObject({
      translated: 0,
      skipped: 1,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
    expect(existsSync(output)).toBe(true)
    expect(existsSync(checkpointPathForOutput(output))).toBe(false)
  })

  it('retries a transient provider failure without guessing failed-attempt usage', async () => {
    const input = join(tmpDir, 'input.po')
    writeFileSync(input, UNTRANSLATED_PO)
    vi.useFakeTimers()
    vi.mocked(generateObject)
      .mockRejectedValueOnce(Object.assign(new Error('service unavailable'), {
        statusCode: 503,
      }))
      .mockResolvedValueOnce({
        object: { translations: ['Instellingen opslaan', 'Annuleren', 'Fout'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)

    try {
      const translation = translateFile({
        input,
        locale: 'nl_NL',
        apiKey: 'test-key',
      })
      const expectation = expect(translation).resolves.toMatchObject({
        translated: 3,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })
      await vi.advanceTimersByTimeAsync(50)

      await expectation
      expect(generateObject).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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
"Project-Id-Version: po-genie test\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: \\n"

msgid "Save"
msgstr "Opslaan"
`.trim()

    const input = join(tmpDir, 'done.po')
    writeFileSync(input, nothingMissing)

    const result = await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })

    expect(result.translated).toBe(0)
    expect(generateObject).not.toHaveBeenCalled()

    const headers = readHeaders(result.output)
    expect(headers.Language).toBe('nl_NL')
    expect(headers['Plural-Forms']).toBe('nplurals=2; plural=(n != 1);')
    expect(headers['Project-Id-Version']).toBe('po-genie test')
  })

  it('rejects an unsupported locale before translating or replacing output', async () => {
    const input = join(tmpDir, 'messages.pot')
    const output = join(tmpDir, 'messages-xx_XX.po')
    writeFileSync(input, UNTRANSLATED_PO)
    writeFileSync(output, 'existing output')

    await expect(
      translateFile({
        input,
        locale: 'xx_XX',
        output,
        apiKey: 'test-key',
      }),
    ).rejects.toThrow('Unsupported gettext plural rules for locale "xx_XX"')

    expect(generateObject).not.toHaveBeenCalled()
    expect(readFileSync(output, 'utf-8')).toBe('existing output')
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

  it.each([
    ['pt_PT_ao90', 'pt_PT_ao90'],
    ['en_US_POSIX', 'en_US_POSIX'],
  ])('preserves the safe gettext locale %s in results and filenames', async (locale, expectedLocale) => {
    const input = join(tmpDir, 'messages.pot')
    writeFileSync(input, UNTRANSLATED_PO)
    mockAI([['Opslaan', 'Annuleren', 'Fout']])

    const [result] = await translate({ input, locale, apiKey: 'test-key' })

    expect(result.locale).toBe(expectedLocale)
    expect(result.output).toBe(join(tmpDir, `messages-${expectedLocale}.po`))
    expect(readFileSync(result.output, 'utf-8')).toContain('msgstr "Opslaan"')
    expect(vi.mocked(generateObject).mock.calls[0][0].messages?.[0].content).toContain(expectedLocale)
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
