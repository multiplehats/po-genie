import { describe, expect, it } from 'vitest'
import { retryTransientProviderCall } from '../src/retry.js'

describe('retryTransientProviderCall', () => {
  it('retries explicit transient provider failures with bounded exponential delays', async () => {
    let attempts = 0
    const delays: number[] = []

    const result = await retryTransientProviderCall(
      async () => {
        attempts++
        if (attempts === 1) {
          throw Object.assign(new Error('rate limited'), { statusCode: 429 })
        }
        if (attempts === 2) {
          throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
        }
        return 'translated'
      },
      async (delayMs) => {
        delays.push(delayMs)
      },
    )

    expect(result).toBe('translated')
    expect(attempts).toBe(3)
    expect(delays).toEqual([50, 100])
  })

  it('stops after three total attempts when transient failures continue', async () => {
    let attempts = 0
    const delays: number[] = []
    const finalError = Object.assign(new Error('service unavailable'), {
      status: 503,
    })

    await expect(retryTransientProviderCall(
      async () => {
        attempts++
        throw finalError
      },
      async (delayMs) => {
        delays.push(delayMs)
      },
    )).rejects.toBe(finalError)

    expect(attempts).toBe(3)
    expect(delays).toEqual([50, 100])
  })

  it.each([
    ['permanent client error', Object.assign(new Error('unauthorized'), { statusCode: 401 })],
    ['structured-output error', Object.assign(new Error('invalid object'), {
      name: 'NoObjectGeneratedError',
    })],
  ])('does not retry a %s without an explicit transient signal', async (_case, failure) => {
    let attempts = 0
    const delays: number[] = []

    await expect(retryTransientProviderCall(
      async () => {
        attempts++
        throw failure
      },
      async (delayMs) => {
        delays.push(delayMs)
      },
    )).rejects.toBe(failure)

    expect(attempts).toBe(1)
    expect(delays).toEqual([])
  })

  it.each([
    'ECONNREFUSED',
    'ENOTFOUND',
    'ECONNABORTED',
  ])('retries the common transient network code %s', async (code) => {
    let attempts = 0

    const result = await retryTransientProviderCall(
      async () => {
        attempts++
        if (attempts === 1) {
          throw Object.assign(new Error(code), { code })
        }
        return 'translated'
      },
      async () => undefined,
    )

    expect(result).toBe('translated')
    expect(attempts).toBe(2)
  })
})
