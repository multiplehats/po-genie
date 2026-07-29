import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/translate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/translate.js')>()
  return {
    ...actual,
    translate: vi.fn(),
  }
})

vi.mock('citty', () => ({
  defineCommand: vi.fn((command) => command),
  runMain: vi.fn(),
}))

import { translate, LocaleTranslationError } from '../src/translate.js'
import { main, parseConcurrency } from '../src/cli.js'
import type { TranslateResult } from '../src/types.js'

function result(locale: string, output: string): TranslateResult {
  return {
    locale,
    output,
    translated: 1,
    skipped: 0,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const baseArgs = {
  input: 'messages.pot',
  locale: 'nl_NL,de_DE',
  output: undefined,
  model: undefined,
  context: undefined,
  'batch-size': undefined,
  concurrency: undefined,
  'all-strings': false,
}

let originalExitCode: string | number | null | undefined

beforeEach(() => {
  vi.clearAllMocks()
  originalExitCode = process.exitCode
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

describe('CLI concurrency', () => {
  it.each([
    ['1', 1],
    ['0', 0],
    ['1.5', 1.5],
    ['abc', Number.NaN],
    [undefined, undefined],
  ])('passes parsed --concurrency %s to the public translation API', async (value, expected) => {
    vi.mocked(translate).mockResolvedValue([])

    await main.run({
      args: {
        ...baseArgs,
        concurrency: value,
      },
    } as any)

    const options = vi.mocked(translate).mock.calls[0][0]
    if (Number.isNaN(expected)) {
      expect(options.concurrency).toSatisfy(Number.isNaN)
    } else {
      expect(options.concurrency).toBe(expected)
    }
    expect(parseConcurrency(value)).toEqual(expected)
  })

  it('reports partial outcomes only after aggregate work settles and sets exitCode cooperatively', async () => {
    const providerWork = deferred<TranslateResult[]>()
    vi.mocked(translate).mockReturnValue(providerWork.promise)
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    const run = main.run({ args: baseArgs } as any)
    await Promise.resolve()
    expect(process.exitCode).toBeUndefined()

    providerWork.reject(new LocaleTranslationError(
      [result('de_DE', '/tmp/messages-de_DE.po')],
      [{ locale: 'nl_NL' }],
      ['fr_FR'],
    ))
    await run

    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('✓ de_DE'),
    )
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('✗ nl_NL'),
    )
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('– fr_FR'),
    )
  })
})
