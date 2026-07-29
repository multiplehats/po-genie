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
  /** String with variables replaced by [VAR_0], [VAR_1], … */
  template: string
  /** Original variable values indexed by their token number */
  vars: string[]
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

const PROTECTED_TOKEN_RE = /\[(?:VAR|IMM\d*)_\d+\]/g
const IMMUTABLE_FRAGMENT_RE = /`+[^`\n]+`+|(?<=\]\()[^)\n]+(?=\))|<\/?[A-Za-z][^>\n]*>|https?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,!?;:]/g

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

  if (differences.length > 0) {
    throw new Error(
      `Protected token integrity failed for locale ${location.locale}, batch ${location.batch}, item ${location.item}: ${differences.join('; ')}`,
    )
  }
}

function immutableTokenPrefix(source: string): string {
  for (let suffix = 0; ; suffix++) {
    const prefix = suffix === 0 ? 'IMM' : `IMM${suffix}`
    if (!new RegExp(`\\[${prefix}_\\d+\\]`).test(source)) return prefix
  }
}

/**
 * Replace source fragments that translation prompts promise to preserve.
 * Natural-language Markdown labels remain available to the model.
 */
export function extractProtectedFragments(source: string): ExtractedProtectedFragments {
  const fragments: string[] = []
  const tokenPrefix = immutableTokenPrefix(source)
  const template = source.replace(IMMUTABLE_FRAGMENT_RE, (fragment) => {
    let index = fragments.indexOf(fragment)
    if (index === -1) {
      index = fragments.length
      fragments.push(fragment)
    }
    return `[${tokenPrefix}_${index}]`
  })

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
  const vars: string[] = []

  const template = str.replace(COMBINED, (match) => {
    let index = vars.indexOf(match)
    if (index === -1) {
      index = vars.length
      vars.push(match)
    }
    return `[VAR_${index}]`
  })

  return { template, vars }
}

/**
 * Restore the original variable values from a translated template.
 * Unknown tokens are left in place rather than silently dropped.
 */
export function restoreVariables(translated: string, vars: string[]): string {
  return translated.replace(/\[VAR_(\d+)\]/g, (token, i) => {
    return vars[parseInt(i, 10)] ?? token
  })
}

/** True when a string contains any recognised variable pattern */
export function hasVariables(str: string): boolean {
  COMBINED.lastIndex = 0
  return COMBINED.test(str)
}
