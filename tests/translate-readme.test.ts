import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReadme } from '../src/readme.js'

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

/**
 * Count the translatable segments in the fixture so tests stay in sync
 * with the fixture file.
 */
function countTranslatable(): number {
  const readme = loadReadme(README_FIXTURE)
  return readme.segments.filter((s) => s.type === 'translatable').length
}

describe('translateFile with readme', () => {
  it('translates a readme and writes output', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    const translations = Array.from({ length: total }, (_, i) => `translated-${i}`)
    mockAI([translations])

    const result = await translateFile({
      input,
      locale: 'nl_NL',
      apiKey: 'test-key',
    })

    expect(result.translated).toBe(total)
    expect(existsSync(result.output)).toBe(true)
  })

  it('output path defaults to readme-{locale}.txt', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    mockAI([Array.from({ length: total }, (_, i) => `translated-${i}`)])

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
    mockAI([Array.from({ length: total }, (_, i) => `translated-${i}`)])

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
    mockAI([Array.from({ length: total }, (_, i) => `translated-${i}`)])

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

  it('all translatable segments have translated content in output', async () => {
    const input = join(tmpDir, 'readme.txt')
    writeFileSync(input, readFileSync(README_FIXTURE))

    const total = countTranslatable()
    const translations = Array.from({ length: total }, (_, i) => `vertaald-${i}`)
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
    mockAI(Array.from({ length: total }, (_, i) => [`translated-${i}`]))
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

    const total = countTranslatable()
    mockAI([
      Array.from({ length: total }, (_, i) => `Nederlands-${i}`),
      Array.from({ length: total }, (_, i) => `Deutsch-${i}`),
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

    const total = countTranslatable()
    mockAI([
      Array.from({ length: total }, (_, i) => `Nederlands-${i}`),
      Array.from({ length: total }, (_, i) => `Deutsch-${i}`),
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
