/**
 * Variable patterns commonly found in gettext strings.
 * Order matters — more specific patterns should come first.
 */
const VARIABLE_PATTERNS: RegExp[] = [
  /\{\{[^}]+\}\}/g,                              // {{variable}} — Handlebars / WP custom
  /%\d+\$[sdifgoxX%]/g,                          // %1$s — positional printf
  /%[sdifgoxX%]/g,                               // %s — printf
  /%\([a-zA-Z_][a-zA-Z0-9_]*\)[sdifgoxX]/g,     // %(name)s — Python style
  /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g,                // {variable} — single-brace
]

// Combined regex built once for efficiency
const COMBINED = new RegExp(
  VARIABLE_PATTERNS.map((r) => r.source).join('|'),
  'g',
)

export interface Extracted {
  /** String with variables replaced by collision-safe [VAR_0], [VAR1_0], … tokens */
  template: string
  /** Original variable values indexed by their token number */
  vars: string[]
  /** Generated token namespace; omitted values are restored as legacy VAR tokens */
  tokenPrefix?: string
}

export interface ProtectedTokenLocation {
  locale: string
  batch: number
  item: number
}

export interface ExtractedProtectedFragments {
  template: string
  fragments: string[]
  tokenPrefix: string
}

const PROTECTED_TOKEN_RE = /\[(?:VAR\d*|IMM\d*)_\d+\]/g
const PROTECTED_TOKEN_EXACT_RE = /^\[(?:VAR\d*|IMM\d*)_\d+\]$/
const VARIABLE_TOKEN_PREFIX = Symbol('variableTokenPrefix')

type VariableValues = string[] & {
  [VARIABLE_TOKEN_PREFIX]?: string
}

interface FragmentSpan {
  start: number
  end: number
}

function runLength(source: string, start: number, character: string): number {
  let end = start
  while (source[end] === character) end++
  return end - start
}

function inlineCodeEnd(source: string, start: number): number | undefined {
  const delimiterLength = runLength(source, start, '`')
  let cursor = start + delimiterLength

  while (cursor < source.length) {
    if (source[cursor] === '\n') return undefined
    if (source[cursor] !== '`') {
      cursor++
      continue
    }

    const candidateLength = runLength(source, cursor, '`')
    if (candidateLength === delimiterLength && cursor > start + delimiterLength) {
      return cursor + candidateLength
    }
    cursor += candidateLength
  }

  return undefined
}

function markdownDestinationEnd(source: string, start: number): number | undefined {
  if (source.slice(start - 2, start) !== '](') return undefined

  let depth = 0
  for (let cursor = start; cursor < source.length; cursor++) {
    const character = source[cursor]
    if (character === '\n') return undefined
    if (character === '\\') {
      cursor++
      continue
    }
    if (character === '(') {
      depth++
      continue
    }
    if (character !== ')') continue
    if (depth === 0) return cursor > start ? cursor : undefined
    depth--
  }

  return undefined
}

function htmlTagEnd(source: string, start: number): number | undefined {
  let cursor = start + 1
  if (source[cursor] === '/') cursor++
  if (!/[A-Za-z]/.test(source[cursor] ?? '')) return undefined

  let quote: '"' | "'" | undefined
  for (; cursor < source.length; cursor++) {
    const character = source[cursor]
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return cursor + 1
  }

  return undefined
}

function standaloneUrlEnd(source: string, start: number): number | undefined {
  const protocol = source.startsWith('https://', start)
    ? 'https://'
    : source.startsWith('http://', start)
      ? 'http://'
      : undefined
  if (!protocol) return undefined

  let depth = 0
  let cursor = start + protocol.length
  for (; cursor < source.length; cursor++) {
    const character = source[cursor]
    if (/\s/.test(character) || '<>"\'`]'.includes(character)) break
    if (character === '(') {
      depth++
      continue
    }
    if (character === ')') {
      if (depth === 0) break
      depth--
    }
  }

  while (cursor > start + protocol.length && '.,!?;:'.includes(source[cursor - 1])) {
    cursor--
  }
  return cursor > start + protocol.length ? cursor : undefined
}

function immutableFragmentSpans(source: string): FragmentSpan[] {
  const spans: FragmentSpan[] = []

  for (let cursor = 0; cursor < source.length;) {
    let end: number | undefined
    if (source[cursor] === '`') end = inlineCodeEnd(source, cursor)
    if (end === undefined) end = markdownDestinationEnd(source, cursor)
    if (end === undefined && source[cursor] === '<') end = htmlTagEnd(source, cursor)
    if (end === undefined && source[cursor] === 'h') end = standaloneUrlEnd(source, cursor)

    if (end === undefined) {
      cursor++
      continue
    }

    spans.push({ start: cursor, end })
    cursor = end
  }

  return spans
}

function countProtectedTokens(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of value.match(PROTECTED_TOKEN_RE) ?? []) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/**
 * Require a model response to contain the same protected-token multiset
 * as its source template. Token order may change with the translation.
 */
export function validateProtectedTokens(
  sourceTemplate: string,
  translated: string,
  location: ProtectedTokenLocation,
): void {
  const sourceCounts = countProtectedTokens(sourceTemplate)
  const translatedCounts = countProtectedTokens(translated)
  const differences: string[] = []

  for (const [token, count] of sourceCounts) {
    const actual = translatedCounts.get(token) ?? 0
    if (actual < count) differences.push(`missing ${token} x${count - actual}`)
    if (actual > count) differences.push(`unexpected ${token} x${actual - count}`)
  }

  for (const [token, count] of translatedCounts) {
    if (!sourceCounts.has(token)) differences.push(`unexpected ${token} x${count}`)
  }

  const unexpectedRawFragments = immutableFragmentSpans(translated)
    .filter((span) => !PROTECTED_TOKEN_EXACT_RE.test(translated.slice(span.start, span.end)))
    .length
  if (unexpectedRawFragments > 0) {
    differences.push(`unexpected raw immutable fragment x${unexpectedRawFragments}`)
  }

  if (differences.length > 0) {
    throw new Error(
      `Protected token integrity failed for locale ${location.locale}, batch ${location.batch}, item ${location.item}: ${differences.join('; ')}`,
    )
  }
}

function availableTokenPrefix(source: string, base: 'VAR' | 'IMM'): string {
  for (let suffix = 0; ; suffix++) {
    const prefix = suffix === 0 ? base : `${base}${suffix}`
    if (!new RegExp(`\\[${prefix}_\\d+\\]`).test(source)) return prefix
  }
}

/**
 * Replace source fragments that translation prompts promise to preserve.
 * Natural-language Markdown labels remain available to the model.
 */
export function extractProtectedFragments(source: string): ExtractedProtectedFragments {
  const fragments: string[] = []
  const tokenPrefix = availableTokenPrefix(source, 'IMM')
  let template = ''
  let cursor = 0

  for (const span of immutableFragmentSpans(source)) {
    const fragment = source.slice(span.start, span.end)
    let index = fragments.indexOf(fragment)
    if (index === -1) {
      index = fragments.length
      fragments.push(fragment)
    }
    template += source.slice(cursor, span.start) + `[${tokenPrefix}_${index}]`
    cursor = span.end
  }
  template += source.slice(cursor)

  return { template, fragments, tokenPrefix }
}

/** Restore immutable fragments after their token multiset has been validated. */
export function restoreProtectedFragments(
  translated: string,
  extracted: ExtractedProtectedFragments,
): string {
  const tokenRe = new RegExp(`\\[${extracted.tokenPrefix}_(\\d+)\\]`, 'g')
  return translated.replace(tokenRe, (token, index) => {
    return extracted.fragments[parseInt(index, 10)] ?? token
  })
}

/**
 * Replace variable patterns with stable numeric tokens so the AI
 * doesn't accidentally translate or mangle them.
 *
 * Duplicate variables get the same token, so the AI only needs to
 * reproduce each token, not count occurrences.
 */
export function extractVariables(str: string): Extracted {
  const vars: VariableValues = []
  const tokenPrefix = availableTokenPrefix(str, 'VAR')
  Object.defineProperty(vars, VARIABLE_TOKEN_PREFIX, {
    value: tokenPrefix,
    enumerable: false,
  })

  const template = str.replace(COMBINED, (match) => {
    let index = vars.indexOf(match)
    if (index === -1) {
      index = vars.length
      vars.push(match)
    }
    return `[${tokenPrefix}_${index}]`
  })

  return { template, vars, tokenPrefix }
}

/**
 * Restore the original variable values from a translated template.
 * Unknown tokens are left in place rather than silently dropped.
 */
export function restoreVariables(
  translated: string,
  vars: string[],
  tokenPrefix?: string,
): string {
  const resolvedPrefix = tokenPrefix ?? (vars as VariableValues)[VARIABLE_TOKEN_PREFIX] ?? 'VAR'
  const tokenRe = new RegExp(`\\[${resolvedPrefix}_(\\d+)\\]`, 'g')
  return translated.replace(tokenRe, (token, i) => {
    return vars[parseInt(i, 10)] ?? token
  })
}

/** True when a string contains any recognised variable pattern */
export function hasVariables(str: string): boolean {
  COMBINED.lastIndex = 0
  return COMBINED.test(str)
}
