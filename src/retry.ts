const MAX_ATTEMPTS = 3
const INITIAL_DELAY_MS = 50

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])

type ErrorFields = {
  status?: unknown
  statusCode?: unknown
  code?: unknown
  isRetryable?: unknown
  cause?: unknown
}

function errorFields(error: unknown): ErrorFields | undefined {
  return typeof error === 'object' && error !== null
    ? error as ErrorFields
    : undefined
}

function isTransientProviderError(error: unknown): boolean {
  const fields = errorFields(error)
  if (!fields) return false
  if (fields.isRetryable === false) return false
  if (fields.isRetryable === true) return true

  const status = typeof fields.statusCode === 'number'
    ? fields.statusCode
    : fields.status
  if (
    typeof status === 'number'
    && (status === 408 || status === 429 || status >= 500 && status <= 599)
  ) {
    return true
  }

  if (
    typeof fields.code === 'string'
    && TRANSIENT_NETWORK_CODES.has(fields.code)
  ) {
    return true
  }

  return fields.cause !== error && isTransientProviderError(fields.cause)
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function retryTransientProviderCall<T>(
  operation: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientProviderError(error)) {
        throw error
      }
      await wait(INITIAL_DELAY_MS * 2 ** (attempt - 1))
    }
  }
}
