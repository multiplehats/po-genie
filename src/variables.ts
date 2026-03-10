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
