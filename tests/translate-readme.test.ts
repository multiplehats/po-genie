import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReadme, parseReadme } from '../src/readme.js'

// ---------------------------------------------------------------------------
// Mock the AI SDK — we don't want real API calls in unit tests
// ---------------------------------------------------------------------------
vi.mock('../src/readme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/readme.js')>()
  return {
    ...actual,
    loadReadme: vi.fn(actual.loadReadme),
    parseReadme: vi.fn(actual.parseReadme),
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

import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
  checkpointPathForOutput,
  createCheckpointIdentity,
  saveCheckpoint,
} from '../src/checkpoint.js'
import { translate, translateFile } from '../src/translate.js'

const README_FIXTURE = join(import.meta.dirname, 'fixtures', 'readme.txt')

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'po-genie-readme-translate-'))
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

function expectDefaultUsageOnlyCheckpoint(output: string): void {
  const checkpoint = JSON.parse(readFileSync(checkpointPathForOutput(output), 'utf8'))
  expect(checkpoint.completedItemIds).toEqual([])
  expect(checkpoint.translations).toEqual({})
  expect(checkpoint.usage).toMatchObject({
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  })
}

/**
 * Count the translatable segments in the fixture so tests stay in sync
 * with the fixture file.
 */
function countTranslatable(): number {
  const readme = loadReadme(README_FIXTURE)
  return readme.segments.filter((s) => s.type === 'translatable').length
}

function fixtureTranslations(prefix: string): string[] {
  const readme = loadReadme(README_FIXTURE)
  return readme.segments
    .filter((segment) => segment.type === 'translatable')
    .map((segment, index) => {
      const protectedToken = segment.content.includes('`/wp-content/plugins/`')
        ? ' [IMM_0]'
        : ''
      return `${prefix}-${index}${protectedToken}`
    })
}

describe('translateFile with readme', () => {
  it('checkpoints a validated readme batch and resumes without requesting it twice', async () => {
    const content = [
      '=== Resume Plugin ===',
      'Contributors: test',
      '',
      'First segment.',
      '',
      '== Description ==',
      '',
      'Second segment.',
      '',
      'Third segment.',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, content)
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Eerste segment.'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockRejectedValueOnce(Object.assign(new Error('bad request'), {
        statusCode: 400,
      }))

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'sk-never-persist',
      context: 'private readme context',
      batchSize: 1,
    })).rejects.toThrow('bad request')

    const checkpointPath = checkpointPathForOutput(output)
    const serialized = readFileSync(checkpointPath, 'utf8')
    const checkpoint = JSON.parse(serialized)
    expect(checkpoint.completedItemIds).toHaveLength(1)
    expect(Object.values(checkpoint.translations)).toEqual(['Eerste segment.'])
    expect(checkpoint.usage).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    })
    expect(serialized).not.toContain('sk-never-persist')
    expect(serialized).not.toContain('private readme context')
    expect(serialized).not.toContain('First segment.')
    expect(serialized).not.toContain('translating a WordPress plugin readme')

    vi.mocked(generateObject).mockReset()
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Tweede segment.'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockResolvedValueOnce({
        object: { translations: ['Derde segment.'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
    const progress: number[] = []

    const result = await translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'sk-never-persist',
      context: 'private readme context',
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
    const saved = readFileSync(output, 'utf8')
    expect(saved).toContain('Eerste segment.')
    expect(saved).toContain('Tweede segment.')
    expect(saved).toContain('Derde segment.')
    expect(saved).not.toContain('First segment.')
    expect(existsSync(checkpointPath)).toBe(false)
  })

  it('carries paid usage from an invalid later readme response into a clean resume', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, [
      '=== Usage Plugin ===',
      'Contributors: test',
      '',
      'First segment.',
      '',
      '== Description ==',
      '',
      'Visit https://example.com.',
      '',
    ].join('\n'))
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Eerste segment.'] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as any)
      .mockResolvedValueOnce({
        object: { translations: ['Bezoek de ongeldige website.'] },
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      } as any)

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })).rejects.toThrow(/item 2.*IMM_0/)

    const checkpointPath = checkpointPathForOutput(output)
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    expect(checkpoint.completedItemIds).toHaveLength(1)
    expect(Object.values(checkpoint.translations)).toEqual(['Eerste segment.'])
    expect(JSON.stringify(checkpoint)).not.toContain('ongeldige')
    expect(checkpoint.usage).toMatchObject({
      promptTokens: 120,
      completionTokens: 60,
      totalTokens: 180,
    })
    expect(checkpoint.usage.estimatedCostUsd).toBeCloseTo(0.000336)

    vi.mocked(generateObject).mockReset()
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { translations: ['Bezoek [IMM_0].'] },
      usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
    } as any)

    const result = await translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize: 1,
    })

    expect(result.usage).toMatchObject({
      promptTokens: 150,
      completionTokens: 75,
      totalTokens: 225,
    })
    expect(readFileSync(output, 'utf8')).toContain('Bezoek https://example.com.')
    expect(readFileSync(output, 'utf8')).not.toContain('ongeldige')
    expect(existsSync(checkpointPath)).toBe(false)
  })

  it.each([
    {
      case: 'stale source',
      prepare(input: string, output: string) {
        saveCheckpoint(output, createCheckpointIdentity({
          source: readFileSync(input),
          targetLocale: 'nl_NL',
          pipeline: 'readme',
          model: 'anthropic/claude-3.5-haiku',
          batchSize: 1,
          onlyMissing: true,
        }), {
          completedItemIds: [],
          translations: {},
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        })
        writeFileSync(input, `${readFileSync(input, 'utf8')}\nChanged source.`)
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
          pipeline: 'readme',
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
          pipeline: 'readme',
          model: 'anthropic/claude-3.5-haiku',
          batchSize: 1,
          onlyMissing: true,
        }), {
          completedItemIds: ['readme:not-a-selected-job'],
          translations: { 'readme:not-a-selected-job': 'Onbekend' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        })
      },
      error: /does not match the selected readme jobs/i,
    },
  ])('rejects a $case checkpoint before creating the readme provider', async ({ prepare, error }) => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, [
      '=== Checkpoint Plugin ===',
      'Contributors: test',
      '',
      'Translate this segment.',
      '',
    ].join('\n'))
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

  it('revalidates protected readme checkpoint text before applying it', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, [
      '=== Protected Resume Plugin ===',
      'Contributors: test',
      '',
      'Visit https://example.com.',
      '',
      '== Description ==',
      '',
      'Second segment.',
      '',
    ].join('\n'))
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { translations: ['Bezoek [IMM_0].'] },
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
    checkpoint.translations[checkpoint.completedItemIds[0]] = 'Bezoek de site.'
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

  it('finishes a zero-job readme with a matching empty checkpoint without a provider', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, [
      '=== Complete Plugin ===',
      'Contributors: test',
      'Stable tag: 1.0.0',
      '',
    ].join('\n'))
    saveCheckpoint(output, createCheckpointIdentity({
      source: readFileSync(input),
      targetLocale: 'nl_NL',
      pipeline: 'readme',
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
      skipped: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
    expect(createOpenRouter).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
    expect(readFileSync(output, 'utf8')).toContain('=== Complete Plugin ===')
    expect(existsSync(checkpointPathForOutput(output))).toBe(false)
  })

  it('translates a readme and writes output', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    const translations = fixtureTranslations('translated')
    mockAI([translations])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result.translated).toBe(total)
    expect(existsSync(result.output)).toBe(true)
  })

  it('disables AI SDK retries so the readme retry boundary controls every provider attempt', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))
    mockAI([fixtureTranslations('translated')])

    await translateFile({ input, locale: 'nl_NL', apiKey: 'test-key' })

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generateObject).mock.calls[0][0]).toMatchObject({
      maxRetries: 0,
    })
  })

  it('plans and saves readme work from the captured identity bytes without rereading the input path', async () => {
    const capturedSource = [
      '=== Captured Plugin ===',
      'Contributors: test',
      '',
      'Captured source.',
      '',
    ].join('\n')
    const changedSource = [
      '=== Changed Plugin ===',
      'Contributors: test',
      '',
      'Changed second read.',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, capturedSource)
    const originalLoadReadme = vi.mocked(loadReadme).getMockImplementation()
    if (!originalLoadReadme) throw new Error('Expected loadReadme mock implementation')
    const loadReadmeMock = vi.mocked(loadReadme)
    try {
      loadReadmeMock.mockImplementationOnce((filePath) => {
        writeFileSync(filePath, changedSource)
        return originalLoadReadme(filePath)
      })
      mockAI([['Vastgelegde vertaling.']])

      await translateFile({
        input,
        output,
        locale: 'nl_NL',
        apiKey: 'test-key',
      })

      expect(loadReadme).not.toHaveBeenCalled()
      const request = vi.mocked(generateObject).mock.calls[0][0] as any
      expect(JSON.parse(request.messages[1].content)).toEqual([
        { text: 'Captured source.', context: 'short description' },
      ])
      const saved = readFileSync(output, 'utf8')
      expect(saved).toContain('=== Captured Plugin ===')
      expect(saved).toContain('Vastgelegde vertaling.')
      expect(saved).not.toContain('Changed second read.')
    } finally {
      loadReadmeMock.mockReset()
      loadReadmeMock.mockImplementation(originalLoadReadme)
    }
  })

  it('output path defaults to readme-{locale}.txt', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    mockAI([fixtureTranslations('translated')])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result.output).toBe(join(tmpDir, 'readme-nl_NL.txt'))
  })

  it('explicit output path overrides the default', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'custom-output.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    mockAI([fixtureTranslations('translated')])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      output,
    })

    expect(result.output).toBe(output)
  })

  it('progress callback fires with correct batch info', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    mockAI([fixtureTranslations('translated')])

    const progress: number[] = []
    await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onProgress: (p) => progress.push(p.translated),
    })

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBe(total)
  })

  it('preserves variables like %s in translated output', async () => {
    // Build a minimal readme with a variable in translatable content
    const content = [
      '=== Var Plugin ===',
      'Contributors: test',
      'Stable tag: 1.0.0',
      '',
      'Upload %s files to translate.',
      '',
      '== Description ==',
      '',
      'This plugin translates %1$s pages in %2$d languages.',
      '',
    ].join('\n')

    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, content)

    // The AI would receive templates with [VAR_0] placeholders and return them
    mockAI([
      [
        'Upload [VAR_0] bestanden om te vertalen.',
        'Deze plugin vertaalt [VAR_0] paginas in [VAR_1] talen.',
      ],
    ])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('%s')
    expect(saved).toContain('%1$s')
    expect(saved).toContain('%2$d')
  })

  it.each([
    ['URL', 'Visit https://example.com/docs for help.', 'Bezoek https://example.nl/docs voor hulp.'],
    ['inline code', 'Run `tool --help` for help.', 'Voer `tool hulp` uit voor hulp.'],
    ['HTML tag', 'Read <strong>this</strong> carefully.', 'Lees <b>dit</b> zorgvuldig.'],
  ])('rejects an altered %s without saving or reporting progress', async (_case, source, response) => {
    const content = [
      '=== Protected Plugin ===',
      'Contributors: test',
      '',
      source,
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, content)
    const progress: number[] = []
    mockAI([[response]])

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
      onProgress: (event) => progress.push(event.translated),
    })).rejects.toThrow(/nl_NL.*batch 1.*item 1.*IMM/)

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(existsSync(output)).toBe(false)
    expectDefaultUsageOnlyCheckpoint(output)
    expect(progress).toEqual([])
  })

  it('translates a Markdown label while preserving its destination exactly', async () => {
    const content = [
      '=== Link Plugin ===',
      'Contributors: test',
      '',
      'Read [the docs](https://example.com/docs).',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, content)
    mockAI([['Lees [de documentatie]([IMM_0]).']])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('Lees [de documentatie](https://example.com/docs).')
  })

  it('validates every readme item before mutating the batch', async () => {
    const content = [
      '=== Atomic Plugin ===',
      'Contributors: test',
      '',
      'Visit https://example.com.',
      '',
      '== Description ==',
      '',
      'Run `tool --help`.',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, content)

    const originalParseReadme = vi.mocked(parseReadme).getMockImplementation()
    if (!originalParseReadme) throw new Error('Expected parseReadme mock implementation')
    const readme = originalParseReadme(readFileSync(input))
    vi.mocked(parseReadme).mockReturnValueOnce(readme)
    mockAI([['Bezoek [IMM_0].', 'Voer hulp uit.']])

    await expect(translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })).rejects.toThrow(/item 2.*IMM_0/)

    expect(
      readme.segments
        .filter((segment) => segment.type === 'translatable')
        .every((segment) => segment.translated === undefined),
    ).toBe(true)
  })

  it('does not retry or checkpoint invalid readme translations on a response-count mismatch', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, [
      '=== Count Plugin ===',
      'Contributors: test',
      '',
      'First segment.',
      '',
      '== Description ==',
      '',
      'Second segment.',
      '',
    ].join('\n'))
    mockAI([['Eerste segment.']])

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })).rejects.toThrow('AI returned 1 translations for 2 inputs')

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(existsSync(output)).toBe(false)
    expectDefaultUsageOnlyCheckpoint(output)
  })

  it('rejects an invented raw immutable fragment even when expected tokens are preserved', async () => {
    const content = [
      '=== Invented Fragment Plugin ===',
      'Contributors: test',
      '',
      'Read [the wiki](https://example.com/Foo_(bar)).',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translated.txt')
    writeFileSync(input, content)
    mockAI([[
      'Lees [de wiki]([IMM_0]) op https://unexpected.example.',
    ]])

    await expect(translateFile({
      input,
      output,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })).rejects.toThrow(/unexpected raw immutable fragment/)

    expect(generateObject).toHaveBeenCalledTimes(1)
    expect(existsSync(output)).toBe(false)
    expectDefaultUsageOnlyCheckpoint(output)
  })

  it('sends readme context as metadata without modifying translated text', async () => {
    const content = [
      '=== Context Plugin ===',
      'Contributors: test',
      '',
      'A [legitimate] short description.',
      '',
      '== Frequently Asked Questions ==',
      '',
      '= Can I keep [brackets]? =',
      '',
      'Yes, [legitimate] bracket text remains visible.',
      '',
    ].join('\n')
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, content)
    const originalParseReadme = vi.mocked(parseReadme).getMockImplementation()
    if (!originalParseReadme) throw new Error('Expected parseReadme mock implementation')
    vi.mocked(parseReadme).mockImplementationOnce((source) => {
      const readme = originalParseReadme(source)
      const faqQuestion = readme.segments.find((segment) => segment.content === 'Can I keep [brackets]?')
      if (faqQuestion) delete faqQuestion.context
      return readme
    })
    mockAI([[
      'Een [legitimate] korte beschrijving.',
      'Kan ik [brackets] behouden?',
      'Ja, [legitimate] tekst tussen haakjes blijft zichtbaar.',
    ]])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const request = vi.mocked(generateObject).mock.calls[0][0] as any
    const userMessage = request.messages.find((message: { role: string }) => message.role === 'user')
    const items = JSON.parse(userMessage.content)

    expect(items).toEqual([
      { text: 'A [legitimate] short description.', context: 'short description' },
      { text: 'Can I keep [brackets]?' },
      { text: 'Yes, [legitimate] bracket text remains visible.', context: 'faq answer' },
    ])

    const saved = readFileSync(result.output, 'utf-8')
    expect(saved).toContain('Een [legitimate] korte beschrijving.')
    expect(saved).toContain('Ja, [legitimate] tekst tussen haakjes blijft zichtbaar.')
    expect(saved).not.toContain('[context:')
  })

  it('all translatable segments have translated content in output', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    const translations = fixtureTranslations('vertaald')
    mockAI([translations])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    const saved = readFileSync(result.output, 'utf-8')
    for (let i = 0; i < total; i++) {
      expect(saved).toContain(`vertaald-${i}`)
    }
  })

  it.each([
    { batchSize: 0, error: 'batchSize must be a positive integer' },
    { batchSize: -1, error: 'batchSize must be a positive integer' },
    { batchSize: Number.NaN, error: 'batchSize must be a positive integer' },
    { batchSize: 1.5, error: 'batchSize must be a positive integer' },
    { batchSize: 1 },
  ])('validates batchSize $batchSize before translating readme segments', async ({ batchSize, error }) => {
    if (error) {
      delete process.env.OPENROUTER_API_KEY
      const translation = translateFile({ input: 'readme.txt', locale: 'nl_NL', batchSize })
      await expect(translation).rejects.toThrow(error)
      expect(generateObject).not.toHaveBeenCalled()
      return
    }

    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))
    const total = countTranslatable()
    mockAI(fixtureTranslations('translated').map((translation) => [translation]))
    const translation = translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
      batchSize,
    })

    await expect(translation).resolves.toMatchObject({ translated: total })
    expect(generateObject).toHaveBeenCalledTimes(total)
  })
})

describe('translate readme with multiple locales', () => {
  it('writes stable, distinct default readme outputs for multiple locales', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    mockAI([
      fixtureTranslations('Nederlands'),
      fixtureTranslations('Deutsch'),
    ])

    const results = await translate({ input, locale: ['nl_NL', 'de_DE'], apiKey: 'test-key' })

    expect(results.map((result) => result.locale)).toEqual(['nl_NL', 'de_DE'])
    expect(results.map((result) => result.output)).toEqual([
      join(tmpDir, 'readme-nl_NL.txt'),
      join(tmpDir, 'readme-de_DE.txt'),
    ])
    expect(new Set(results.map((result) => result.output)).size).toBe(2)
    expect(readFileSync(join(tmpDir, 'readme-nl_NL.txt'), 'utf-8')).toContain('Nederlands-0')
    expect(readFileSync(join(tmpDir, 'readme-de_DE.txt'), 'utf-8')).toContain('Deutsch-0')
  })

  it('treats an explicit output as a directory and writes one readme per locale', async () => {
    const input = join(tmpDir, 'readme.txt')
    const output = join(tmpDir, 'translations')
    mkdirSync(output)
    writeFileSync(input, readFileSync(README_FIXTURE))

    mockAI([
      fixtureTranslations('Nederlands'),
      fixtureTranslations('Deutsch'),
    ])

    const results = await translate({
      input,
      locale: ['nl_NL', 'de_DE'],
      output,
      apiKey: 'test-key',
    })

    expect(results.map((result) => result.locale)).toEqual(['nl_NL', 'de_DE'])
    expect(results.map((result) => result.output)).toEqual([
      join(output, 'readme-nl_NL.txt'),
      join(output, 'readme-de_DE.txt'),
    ])
    expect(readFileSync(join(output, 'readme-nl_NL.txt'), 'utf-8')).toContain('Nederlands-0')
    expect(readFileSync(join(output, 'readme-de_DE.txt'), 'utf-8')).toContain('Deutsch-0')
  })
})
